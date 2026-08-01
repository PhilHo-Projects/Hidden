# Online Match Rules Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server resolve one immutable ruleset for every online match and route rematches through the existing two-player ready handshake.

**Architecture:** Each package owns the same small `MatchRules` wire contract and defensive decoder. The server derives roles from `ADMIN_USERNAMES`, accepts proposals only from the authenticated socket identity, resolves and stores one clamped ruleset at match creation, and sends it in `MATCH_FOUND`; the client stores that ruleset independently of offline settings and uses it for every `GAME_START` in the match.

**Tech Stack:** TypeScript 5.9, Node 24, Express 5, `ws` 8, MessagePack 3, React 19, Vitest 4, Vite 8

## Global Constraints

- Preserve every active numeric `PacketType`; only append the optional rules map to existing packet arrays.
- Treat the connection-assigned client ID and authenticated WebSocket identity as authoritative; ignore sender IDs and roles supplied in packets.
- `DEFAULT_MATCH_RULES` is `{ rounds: 6, turnSeconds: 10, blindMode: true }`.
- Clamp `rounds` to 1-20 and `turnSeconds` to 2-60; malformed or partially typed rule maps are absent.
- Guests and authenticated players are never administrators unless their normalized username is in `ADMIN_USERNAMES`.
- Offline bot play continues to use local Advanced settings.
- Add or update tests before each runtime behavior change.
- Keep structured logging and never log raw packet bodies at `info`.

---

### Task 1: Define and validate the shared rules wire contract

**Files:**
- Create: `server/src/matchRules.test.ts`
- Create: `server/src/matchRules.ts`
- Modify: `server/src/protocol.test.ts`
- Modify: `server/src/protocol.ts`
- Create: `web/src/game/matchRules.test.ts`
- Create: `web/src/game/matchRules.ts`
- Modify: `web/src/game/__tests__/protocol.test.ts`
- Modify: `web/src/game/protocol.ts`

**Interfaces:**
- Produces in both packages: `MatchRules`, `DEFAULT_MATCH_RULES`, `decodeMatchRules(value: unknown): MatchRules | undefined`, and `clampMatchRules(value: Partial<Record<keyof MatchRules, unknown>> | null | undefined): MatchRules`.
- Produces on the server: `ClientPacket` matchmaking requests with `proposedRules?: MatchRules`.
- Produces on the client: `MATCH_FOUND` packets with a resolved `rules: MatchRules`, defaulting when the trailing map is absent or malformed.

- [ ] **Step 1: Write failing rule-decoder and clamp tests in both packages**

```ts
it('clamps numeric rules and rejects partial wire maps', () => {
  expect(clampMatchRules({ rounds: 999, turnSeconds: 0, blindMode: false })).toEqual({
    rounds: 20,
    turnSeconds: 2,
    blindMode: false,
  })
  expect(clampMatchRules({ rounds: Number.NaN, turnSeconds: 'fast', blindMode: 'yes' })).toEqual({
    rounds: 6,
    turnSeconds: 10,
    blindMode: true,
  })
  expect(decodeMatchRules({ rounds: 3, turnSeconds: '10', blindMode: true })).toBeUndefined()
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run from each package: `npm test -- src/matchRules.test.ts` and `npm test -- src/game/matchRules.test.ts`.
Expected: FAIL because the `matchRules` modules do not exist.

- [ ] **Step 3: Implement the mirrored rule primitives**

```ts
export interface MatchRules {
  rounds: number
  turnSeconds: number
  blindMode: boolean
}

export const DEFAULT_MATCH_RULES: MatchRules = Object.freeze({
  rounds: 6,
  turnSeconds: 10,
  blindMode: true,
})

export function decodeMatchRules(value: unknown): MatchRules | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.rounds !== 'number' || !Number.isFinite(candidate.rounds) ||
    typeof candidate.turnSeconds !== 'number' || !Number.isFinite(candidate.turnSeconds) ||
    typeof candidate.blindMode !== 'boolean'
  ) return undefined
  return {
    rounds: candidate.rounds,
    turnSeconds: candidate.turnSeconds,
    blindMode: candidate.blindMode,
  }
}

export function clampMatchRules(
  value: Partial<Record<keyof MatchRules, unknown>> | null | undefined,
): MatchRules {
  const rounds = typeof value?.rounds === 'number' && Number.isFinite(value.rounds)
    ? value.rounds
    : DEFAULT_MATCH_RULES.rounds
  const turnSeconds = typeof value?.turnSeconds === 'number' && Number.isFinite(value.turnSeconds)
    ? value.turnSeconds
    : DEFAULT_MATCH_RULES.turnSeconds
  return {
    rounds: Math.min(20, Math.max(1, Math.trunc(rounds))),
    turnSeconds: Math.min(60, Math.max(2, Math.trunc(turnSeconds))),
    blindMode: typeof value?.blindMode === 'boolean'
      ? value.blindMode
      : DEFAULT_MATCH_RULES.blindMode,
  }
}
```

- [ ] **Step 4: Verify the primitives GREEN**

Run the same focused test commands. Expected: both files pass.

- [ ] **Step 5: Write failing protocol tests for the optional map**

```ts
expect(decodeClientPacket(encode([0, PacketType.MATCHMAKING_REQUEST, true, {
  rounds: 8,
  turnSeconds: 15,
  blindMode: false,
}]))).toEqual({
  type: PacketType.MATCHMAKING_REQUEST,
  searching: true,
  proposedRules: { rounds: 8, turnSeconds: 15, blindMode: false },
})

expect(decodePacket(encode([0, PacketType.MATCH_FOUND, 'room-1']))).toMatchObject({
  type: PacketType.MATCH_FOUND,
  rules: DEFAULT_MATCH_RULES,
})
```

- [ ] **Step 6: Run protocol tests and verify RED**

Run: `npm test -- src/protocol.test.ts` in `server/` and `npm test -- src/game/__tests__/protocol.test.ts` in `web/`.
Expected: FAIL because matchmaking does not decode proposals and `MATCH_FOUND` has no rules.

- [ ] **Step 7: Append the rules map without changing packet numbers**

Decode `packet[3]` with `decodeMatchRules` on both sides. Server matchmaking packets retain `searching` and add `proposedRules` only when decoding succeeds. Client `MATCH_FOUND` returns `clampMatchRules(decodedRules ?? DEFAULT_MATCH_RULES)` and its encoder accepts an optional proposal map for `startMatchmaking`.

- [ ] **Step 8: Verify protocol GREEN and commit the contract slice**

Run both focused protocol suites plus both match-rule suites. Expected: all pass.

```powershell
git add server/src/matchRules.ts server/src/matchRules.test.ts server/src/protocol.ts server/src/protocol.test.ts web/src/game/matchRules.ts web/src/game/matchRules.test.ts web/src/game/protocol.ts web/src/game/__tests__/protocol.test.ts
git commit -m "feat(protocol): define online match rules"
```

### Task 2: Derive administrator roles from server configuration

**Files:**
- Modify: `server/src/serverConfig.test.ts`
- Modify: `server/src/serverConfig.ts`
- Modify: `server/src/auth/service.test.ts`
- Modify: `server/src/auth/service.ts`
- Modify: `server/src/auth/http.ts`
- Modify: `server/src/auth/http.app.test.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`
- Modify: `web/src/auth/authClient.test.ts`
- Modify: `web/src/auth/authClient.ts`

**Interfaces:**
- Produces: `resolveAdminUsernames(value: string | undefined): Set<string>`.
- Produces: `UserRole = 'player' | 'admin'` and `AuthenticatedUser = AuthUser & { role: UserRole }`.
- Changes: `AuthSession.user`, `AuthServiceLike.getSession`, HTTP auth responses, and `ClientIdentity` to carry `AuthenticatedUser` role.

- [ ] **Step 1: Write failing configuration and role tests**

```ts
expect(resolveAdminUsernames(undefined)).toEqual(new Set())
expect(resolveAdminUsernames(' Ecco,PLAYER_two, ')).toEqual(new Set(['ecco', 'player_two']))

const { service } = await createService(undefined, new Set(['player_one']))
await expect(service.register({
  username: 'Player_One',
  password: 'correct horse battery staple',
})).resolves.toMatchObject({ user: { role: 'admin' } })
```

Also update HTTP/auth-client fixtures to expect `role: 'player'`, and add an authenticated WebSocket test proving the role comes from `getSession` rather than any packet value.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/serverConfig.test.ts src/auth/service.test.ts src/auth/http.app.test.ts src/app.test.ts` in `server/`, and `npm test -- src/auth/authClient.test.ts` in `web/`.
Expected: FAIL on missing role/config support.

- [ ] **Step 3: Implement one role-resolution path**

`AuthService.create` accepts `adminUsernames?: ReadonlySet<string>`. A private `withRole(user)` returns `{ ...user, role: adminUsernames.has(user.username.trim().toLowerCase()) ? 'admin' : 'player' }`; `register`, `login`, and `getSession` all use it. `server.ts` passes `resolveAdminUsernames(process.env.ADMIN_USERNAMES)`. HTTP responses expose the role, while the WebSocket upgrade copies `user.role` into `ClientIdentity`.

- [ ] **Step 4: Verify role tests GREEN and commit**

Run the focused commands again. Expected: all pass.

```powershell
git add server/src/serverConfig.ts server/src/serverConfig.test.ts server/src/auth/service.ts server/src/auth/service.test.ts server/src/auth/http.ts server/src/auth/http.app.test.ts server/src/server.ts server/src/app.ts server/src/app.test.ts web/src/auth/authClient.ts web/src/auth/authClient.test.ts
git commit -m "feat(auth): derive administrator roles"
```

### Task 3: Resolve and retain authoritative rules in the game handler

**Files:**
- Modify: `server/src/gameHandler.ts`
- Modify: `server/src/app.test.ts`

**Interfaces:**
- Consumes: `ClientPacket.proposedRules`, authenticated `ClientIdentity.role`, `DEFAULT_MATCH_RULES`, and `clampMatchRules`.
- Produces: `ClientSession.proposedRules?: MatchRules`, `Match.rules: MatchRules`, and `[0, PacketType.MATCH_FOUND, roomId, rules]` for both players.

- [ ] **Step 1: Add failing integration tests for every server done-condition**

Use two `Probe` clients and cookie-backed `AuthServiceLike` identities to cover:

```ts
expect(firstMatch[3]).toEqual(DEFAULT_MATCH_RULES) // non-admin proposal ignored
expect(firstMatch[3]).toEqual({ rounds: 20, turnSeconds: 2, blindMode: false }) // admin proposal clamped
expect(firstMatch[3]).toEqual(secondMatch[3]) // one resolved object sent to both
```

Send `{ rounds: 4, turnSeconds: 'bad', blindMode: true }` and assert `MATCH_FOUND` uses defaults while the probe socket remains open. Queue two admins with different proposals and assert the earlier queue entry wins. After the first pair of `GAME_START` packets, send a second `READY_STATE true` from each player and assert a second pair arrives.

- [ ] **Step 2: Run the server integration file and verify RED**

Run: `npm test -- src/app.test.ts` in `server/`.
Expected: FAIL because match proposals are ignored and `MATCH_FOUND` carries only the room ID.

- [ ] **Step 3: Implement the minimal authority logic**

Initialize every session role as `identity?.role ?? 'player'`. On matchmaking cancellation, delete the queue entry and clear `proposedRules`. On a new search, overwrite `proposedRules` with the decoded proposal only for admins; discard and debug-log a non-admin proposal. In `tryCreateMatch`, choose the first proposal in queue order or defaults, clamp once, store it in `Match.rules`, and send the same `rules` value to both players.

- [ ] **Step 4: Run integration and full server tests GREEN, then commit**

Run: `npm test -- src/app.test.ts` and `npm test` in `server/`. Expected: all non-integration tests pass and existing integration skips remain skips.

```powershell
git add server/src/gameHandler.ts server/src/app.test.ts
git commit -m "fix(server): make online rules authoritative"
```

### Task 4: Consume server rules and repair online rematches

**Files:**
- Modify: `web/src/game/networkClient.ts`
- Modify: `web/src/game/__tests__/networkClient.test.ts`
- Create: `web/src/game/onlineMatch.test.ts`
- Create: `web/src/game/onlineMatch.ts`
- Modify: `web/src/components/PregameUi.tsx`
- Modify: `web/src/components/__tests__/PregameUi.test.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Changes: `NetworkClient.startMatchmaking(rules?: MatchRules)` and `ClientEvent` match-found events with `rules`.
- Produces: `createOnlineMatchConfig(rules: MatchRules): MatchConfig` and `restartMatch(options): void`, where online restart calls `sendReady(true)` plus `showReady()` and never invokes local countdown.
- Produces: `MatchRulesSummary` and an admin-gated online settings wrapper for static-render tests.

- [ ] **Step 1: Write failing network, config, rematch, and render tests**

```ts
expect(createOnlineMatchConfig({ rounds: 3, turnSeconds: 25, blindMode: false })).toMatchObject({
  rounds: 3,
  turnSeconds: 25,
  blindMode: false,
  isOnline: true,
  hasAI: false,
})

restartMatch({
  match: onlineMatch,
  sendReady,
  showReady,
  beginLocalMatch,
})
expect(sendReady).toHaveBeenCalledWith(true)
expect(showReady).toHaveBeenCalledOnce()
expect(beginLocalMatch).not.toHaveBeenCalled()
```

Capture the bytes sent by `startMatchmaking(adminRules)` and assert the trailing value is a keyed map. Feed a `MATCH_FOUND` packet into the network client and assert its event carries the clamped rules. Static-render `MatchRulesSummary` and assert rounds/timer/blind text. Static-render the admin settings guard for `null`, player, and admin identities; only the admin markup contains `Advanced`.

- [ ] **Step 2: Run focused web tests and verify RED**

Run: `npm test -- src/game/__tests__/networkClient.test.ts src/game/onlineMatch.test.ts src/components/__tests__/PregameUi.test.ts`.
Expected: FAIL on the absent interfaces and UI.

- [ ] **Step 3: Implement the client flow**

Store `match-found.rules` in `onlineRulesRef`, render those rules on the ready screen, and make the `game-start` branch call `createOnlineMatchConfig(onlineRulesRef.current ?? DEFAULT_MATCH_RULES)` without reading `settingsRef`. Pass local settings to `startMatchmaking` only when `authUser?.role === 'admin'`. Render Advanced settings on the online menu only for that role. Route online `AGAIN?` through `restartMatch` so it sends ready and returns to the ready screen; keep offline restart immediate.

- [ ] **Step 4: Verify focused and full web suites GREEN, then commit**

Run the focused command and `npm test` in `web/`. Expected: all pass.

```powershell
git add web/src/game/networkClient.ts web/src/game/__tests__/networkClient.test.ts web/src/game/onlineMatch.ts web/src/game/onlineMatch.test.ts web/src/components/PregameUi.tsx web/src/components/__tests__/PregameUi.test.ts web/src/App.tsx
git commit -m "fix(web): use server rules for online matches"
```

### Task 5: Verify the acceptance contract and production artifact

**Files:**
- Modify only if verification reveals a scoped defect in the files above.

**Interfaces:**
- Consumes all prior tasks; produces no new runtime interface.

- [ ] **Step 1: Run every required package command fresh**

```powershell
Push-Location web
npm test
npm run lint
npm run build
Pop-Location
Push-Location server
npm test
npm run build
Pop-Location
```

- [ ] **Step 2: Build the root production container**

Run: `docker build -t hidden:online-match-rules-authority .`
Expected: every Docker stage exits successfully and the runtime image is created.

- [ ] **Step 3: Audit the diff against the spec test list**

Run: `git diff 499d5d8...HEAD --check`, `git diff 499d5d8...HEAD --stat`, and `git log --oneline 499d5d8..HEAD`.
Confirm each server and client bullet in the design's Testing section has a passing named test, packet IDs are unchanged, no credentials or deployment workflow were added, and offline start still reads local settings.
