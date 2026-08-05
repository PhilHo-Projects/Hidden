# Delete the Mode Registry and MatchRules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead `ModeRef` / `ModeRegistry` / `MODE_REGISTRY` / `CLASSIC_V1` / `MatchRules` family from `@hidden/game-core`, make `GameSpec` a required `{ engine, config, seed, firstSeat }`, and delete the legacy-shape shim in `createGame`.

**Architecture:** Two-phase deletion. Phase one migrates every remaining consumer off the legacy `{ mode, rules }` spec shape while the shim still accepts both — every test stays green and every commit is bisectable. Phase two deletes the now-unreferenced exports. Nothing in the runtime path changes behaviour; the only non-deletion edit is a type-only widening of one server parameter that was already lying about what it accepts.

**Tech Stack:** TypeScript 5.9, Node 24, `node --test` (game-core), Vitest (server and web), Vite 8 + React 19 (web).

## Global Constraints

- Node 24. npm workspaces: `web`, `server`, `packages/game-core`.
- **`ENGINE_ID` stays `'classic'` and `ENGINE_REVISION` stays `1`.** This change touches no placement resolution, no scoring, and no RNG. Bumping the revision here would be wrong.
- **Preserve numeric packet IDs.** This plan touches no packet, no wire shape, and no protocol file.
- Preserve online matchmaking, lobby, ready/start, moves, power-ups, disconnect handling, and offline bot play.
- Keep the `createTopology(3, 3)` test asserting the legacy 3x3 pattern order. It uses the `LEGACY_3X3_PATTERNS` literal, not `CLASSIC_V1`, and is the guard that the original game still plays identically. **Do not touch it.**
- `MatchRulesSummary` in `web/src/components/PregameUi.tsx` is a **React component that takes a `GameConfig`**. It is a name collision, not part of the `MatchRules` family. **Do not rename or delete it**, and do not touch `web/src/App.tsx` or `web/src/components/__tests__/PregameUi.test.ts`.
- Verification commands, run from the repo root: `npm test`, `npm run build`, `npm run lint`.

---

## Findings that change the roadmap's description

The roadmap says "a few tests still do [use it]". Three things it does not mention, all confirmed by reading the files:

1. **`server/src/app.test.ts:425-430` and `web/src/game/coreAdapter.test.ts:122,141` still call `createGame` with the legacy `{ mode, rules }` shape.** These are real call sites, not just type imports.
2. **`server/src/matchCoordinator.test.ts:161,163,164` are vacuously-passing assertions.** `run.spec` is a `ResolvedGameSpec`, which has no `.rules` or `.mode`; `MatchRoom` has no `.rules` either. So line 161 asserts `undefined === undefined`, and lines 163-164 assert `Object.isFrozen(undefined)`, which is `true`. They have never tested anything. They get deleted, not migrated.
3. **`web/src/game/matchRules.ts` is entirely dead** — its only importer is its own test file. Both files get deleted. (`server/src/matchRules.ts` is *not* dead: `app.test.ts`, `gameHandler.ts`, and `protocol.ts` import `GameConfig` things from it. It only gets trimmed.)

Also relevant to why this rot survived: `packages/game-core/tsconfig.json` and `server/tsconfig.json` both `exclude: ["src/**/*.test.ts"]`, so core and server tests are never typechecked. `web/tsconfig.app.json` includes `src`, so **web tests are typechecked** and `npm run build` in `web/` is a real gate for Task 3.

---

## File Structure

| File | Change |
| --- | --- |
| `packages/game-core/src/index.ts` | Delete `MatchRules`, `DEFAULT_MATCH_RULES`, `decodeMatchRules`, `clampMatchRules`, `ModeRef`, `ModeRegistry`, `CLASSIC_V1`, `MODE_REGISTRY`. Tighten `GameSpec`. Inline engine validation into `createGame`, delete `resolveSpec`. |
| `packages/game-core/src/index.test.ts` | Migrate `baseSpec` and five `rules:` overrides. Delete the registry test and the `shared match rules` block. |
| `server/src/matchCoordinator.ts` | Type-only: widen `proposedConfig?: GameConfig` to `Partial<GameConfig>`. |
| `server/src/matchCoordinator.test.ts` | Drop the `MatchRules` import, replace one `satisfies`, delete three vacuous assertions. |
| `server/src/app.test.ts` | Migrate one legacy `createGame` call. |
| `server/src/matchRules.ts` | Drop the three `MatchRules` re-exports. |
| `server/src/matchRules.test.ts` | **Delete.** It only tests deleted functions. |
| `web/src/game/coreAdapter.test.ts` | Migrate two legacy `createGame` calls. |
| `web/src/game/matchRules.ts` | **Delete.** Dead module. |
| `web/src/game/matchRules.test.ts` | **Delete.** |
| `docs/ROADMAP.md` | Remove the completed "Next up" item 1, renumber the rest. |

Things that must survive, because a careless deletion would take them out:

- `finiteNumberOrDefault` (`index.ts:62-64`) — still used by `clampInteger` at line 153.
- `deepFreeze` (`index.ts:290-298`) — sits *between* `ModeRegistry` and `CLASSIC_V1`; used by `createTopology`, `DEFAULT_GAME_CONFIG`, and `buildMode`.
- `ClassicMode` interface (`index.ts:279-286`) — `CLASSIC_V1` is typed with it, but `GameState.mode` and `buildMode` still need it.
- `ResolvedGameSpec` — `server/src/matchCoordinator.ts` imports it at line 14 and uses it at 67 and 202. It survives as an alias.

---

### Task 1: Migrate every consumer off the legacy `{ mode, rules }` spec shape

Nothing is deleted in this task. The shim still accepts both shapes, so the suite is green before *and* after. This is the bisect-safe half.

**Files:**
- Modify: `packages/game-core/src/index.test.ts:29-35, 299, 345, 392, 416, 427, 596-600`
- Modify: `server/src/app.test.ts:425-430`
- Modify: `web/src/game/coreAdapter.test.ts:122-127, 141-146`

**Interfaces:**
- Consumes: the current `createGame(spec: GameSpec)` with optional `engine`/`config`.
- Produces: no source file in the repo passes `mode` or `rules` to `createGame` any more. Task 2 depends on this being true.

- [ ] **Step 1: Rewrite `baseSpec` in the core test to the current shape**

In `packages/game-core/src/index.test.ts`, replace lines 29-35:

```ts
const baseSpec = (overrides: Partial<GameSpec> = {}): GameSpec => ({
  engine: { id: ENGINE_ID, revision: ENGINE_REVISION },
  config: DEFAULT_GAME_CONFIG,
  seed: 0x1234abcd,
  firstSeat: 0,
  ...overrides,
})
```

This is behaviour-identical to the old version. The old one resolved to
`clampGameConfig({ ...DEFAULT_GAME_CONFIG, rounds: 6, turnSeconds: 10, blindMode: true })`,
and those three values *are* the `DEFAULT_GAME_CONFIG` values.

- [ ] **Step 2: Replace the five `rules:` overrides with `config:` overrides**

Same file. Each `baseSpec({ rules: { ...DEFAULT_MATCH_RULES, rounds: N } })` becomes
`baseSpec({ config: { ...DEFAULT_GAME_CONFIG, rounds: N } })`:

- line 299: `rounds: 20`
- line 345: `rounds: 10`
- line 392: `baseSpec({ seed: 1, config: { ...DEFAULT_GAME_CONFIG, rounds: 10 } })`
- line 416: `rounds: 1`
- line 427: `rounds: 1`

- [ ] **Step 3: Retarget the legacy-spec test at line 596**

Replace the test at `packages/game-core/src/index.test.ts:596-600`:

```ts
  it('produces the default game from the default config', () => {
    const game = createGame(baseSpec())
    assert.deepEqual(game.config, DEFAULT_GAME_CONFIG)
    assert.equal(game.boards[0].locations.length, 9)
  })
```

The assertions are unchanged — only the name and the shape it exercises change.

- [ ] **Step 4: Run the core tests**

```bash
npm run test:core
```

Expected: PASS, same test count as before minus zero (no test was removed).

- [ ] **Step 5: Fix the legacy `createGame` call in the server integration test**

`server/src/app.test.ts:425-430`. The local `descriptor` type at lines 413-420 declares `engine` and `config`, but the call reads `descriptor.mode` and `descriptor.rules`, which are `undefined` at runtime — the test passes today only because the shim falls back to defaults. Replace with:

```ts
    let canonical: CoreGameState = createGame({
      engine: descriptor.engine,
      config: descriptor.config,
      seed: descriptor.seed,
      firstSeat: descriptor.firstSeat,
    })
```

- [ ] **Step 6: Fix the two legacy `createGame` calls in the web adapter test**

`web/src/game/coreAdapter.test.ts`. At lines 122-127 and 141-146, replace `mode: { id: 'classic', revision: 1 }` with `engine: { id: 'classic', revision: 1 }` and `rules: config` with `config`. The first becomes:

```ts
    const canonical = createGame({
      engine: { id: 'classic', revision: 1 },
      config,
      seed: 42,
      firstSeat: 1,
    })
```

and the second is identical except `firstSeat: 0`.

- [ ] **Step 7: Run the full suite**

```bash
npm test
```

Expected: PASS across lockfile, core, web, and server.

- [ ] **Step 8: Commit**

```bash
git add packages/game-core/src/index.test.ts server/src/app.test.ts web/src/game/coreAdapter.test.ts
git commit -m "test: migrate the last callers off the legacy mode+rules spec"
```

---

### Task 2: Delete the registry and MatchRules from game-core

**Files:**
- Modify: `packages/game-core/src/index.ts:8-60, 236-272, 288, 300-331, 449-451`
- Modify: `packages/game-core/src/index.test.ts:4-27, 76-85, 434-453`

**Interfaces:**
- Consumes: Task 1's guarantee that no caller passes `mode` or `rules`.
- Produces: `GameSpec` is `{ engine: EngineRef; config: GameConfig; seed: number; firstSeat: Seat }`, all required. `ResolvedGameSpec` is an exported alias of `GameSpec`. `createGame(spec: GameSpec): GameState` still throws `/engine/i` on a revision mismatch, still clamps the config, still coerces the seed with `>>> 0`.

- [ ] **Step 1: Delete the MatchRules family from `index.ts`**

Delete lines 8-60 — the `MatchRules` interface, `DEFAULT_MATCH_RULES`, `decodeMatchRules`, and `clampMatchRules`.

**Keep `finiteNumberOrDefault` at lines 62-64.** It is used by `clampInteger` at line 153. Deleting it breaks `clampGameConfig`.

- [ ] **Step 2: Replace `ModeRef`, `GameSpec`, `ResolvedGameSpec`, and `resolveSpec`**

Replace `index.ts:236-272` in full with:

```ts
export interface GameSpec {
  readonly engine: EngineRef
  readonly config: GameConfig
  readonly seed: number
  readonly firstSeat: Seat
}

// `GameState.spec` and the server's `MatchRun` refer to the spec after
// `createGame` has normalised it. Normalisation no longer changes the shape,
// so this is an alias rather than a second interface.
export type ResolvedGameSpec = GameSpec
```

- [ ] **Step 3: Delete the mode registry, keeping `deepFreeze`**

Delete the `ModeRegistry` type alias at line 288, and `CLASSIC_V1` plus `MODE_REGISTRY` at lines 300-331.

**Keep `deepFreeze` at lines 290-298.** It sits between the two deletions and is used by `createTopology`, `DEFAULT_GAME_CONFIG`, and `buildMode`.

**Keep the `ClassicMode` interface at lines 279-286.** `GameState.mode` and `buildMode` both need it.

- [ ] **Step 4: Inline the engine check into `createGame`**

Replace `index.ts:449-451` (the first three lines of `createGame`) with:

```ts
export function createGame(spec: GameSpec): GameState {
  if (spec.engine.id !== ENGINE_ID || spec.engine.revision !== ENGINE_REVISION) {
    throw new Error(
      `Unsupported engine ${spec.engine.id}@${spec.engine.revision}; this build runs ${ENGINE_ID}@${ENGINE_REVISION}.`,
    )
  }
  const resolved: ResolvedGameSpec = {
    engine: spec.engine,
    config: clampGameConfig(spec.config),
    seed: spec.seed >>> 0,
    firstSeat: spec.firstSeat,
  }
  const mode = buildMode(resolved.config)
```

The rest of the function body is unchanged. The error message is copied verbatim from `resolveSpec` so the `assert.throws(..., /engine/i)` test at line 607 keeps passing.

- [ ] **Step 5: Clean the core test imports**

In `packages/game-core/src/index.test.ts:4-27`, remove `CLASSIC_V1`, `DEFAULT_MATCH_RULES`, `MODE_REGISTRY`, `clampMatchRules`, `decodeMatchRules`, `type ModeRegistry`, and `type ClassicMode` (the last is imported but never used once the registry test is gone). The import block becomes:

```ts
import {
  ENGINE_ID,
  ENGINE_REVISION,
  createTopology,
  clampGameConfig,
  decodeGameConfig,
  DEFAULT_GAME_CONFIG,
  type GameConfig,
  applyCommand,
  applyTimeout,
  createGame,
  type ApplyResult,
  type GameCommand,
  type GameSpec,
  type GameState,
  type Seat,
} from './index.ts'
```

- [ ] **Step 6: Delete the registry test and rename its describe block**

Delete the test at lines 77-85 (`publishes immutable classic mode data with the locked random algorithm`) — every symbol it asserts on is gone. Keep the second test in that block (`constructs boards from the config topology instead of a nine-cell assumption`), and rename the enclosing describe:

```ts
describe('engine construction', () => {
```

- [ ] **Step 7: Delete the `shared match rules` block**

Delete `packages/game-core/src/index.test.ts:434-453` in full — the whole `describe('shared match rules', ...)`. Both of its tests only exercise `decodeMatchRules` and `clampMatchRules`.

- [ ] **Step 8: Run the core tests**

```bash
npm run test:core
```

Expected: PASS. Three tests fewer than before (one registry, two match-rules).

- [ ] **Step 9: Confirm the symbols are actually gone from the built package**

```bash
npm run build:core && grep -rn "MODE_REGISTRY\|CLASSIC_V1\|MatchRules\|ModeRef" packages/game-core/dist/index.d.ts
```

Expected: `grep` finds nothing and exits 1. If it prints matches, the build is stale — rerun `npm run build:core`.

- [ ] **Step 10: Commit**

```bash
git add packages/game-core/src/index.ts packages/game-core/src/index.test.ts
git commit -m "refactor(core): delete the mode registry and MatchRules"
```

---

### Task 3: Delete the dead matchRules modules in server and web

**Files:**
- Modify: `server/src/matchRules.ts`
- Delete: `server/src/matchRules.test.ts`
- Modify: `server/src/matchCoordinator.ts:256`
- Modify: `server/src/matchCoordinator.test.ts:1-16, 67-71, 161-164`
- Delete: `web/src/game/matchRules.ts`
- Delete: `web/src/game/matchRules.test.ts`

**Interfaces:**
- Consumes: Task 2's `@hidden/game-core` with no `MatchRules` exports.
- Produces: `server/src/matchRules.ts` re-exports only `DEFAULT_GAME_CONFIG`, `clampGameConfig`, `decodeGameConfig`, and `type GameConfig`. `MatchCoordinator.enqueueQuickMatch(participant, proposedConfig?: Partial<GameConfig>)`.

- [ ] **Step 1: Trim the server re-export shim**

Replace `server/src/matchRules.ts` in full:

```ts
export {
  DEFAULT_GAME_CONFIG,
  clampGameConfig,
  decodeGameConfig,
} from '@hidden/game-core'
export type { GameConfig } from '@hidden/game-core'
```

`clampGameConfig` is kept even though the current importers only use the other three — `matchCoordinator.ts` imports it straight from `@hidden/game-core`, and dropping it here would be an unrelated behaviour change to the module's surface.

- [ ] **Step 2: Delete the server match-rules test**

```bash
git rm server/src/matchRules.test.ts
```

Every test in it calls `clampMatchRules` or `decodeMatchRules`. There is nothing left to keep.

- [ ] **Step 3: Widen the `proposedConfig` parameter**

`server/src/matchCoordinator.ts:256`. Change:

```ts
    proposedConfig?: Partial<GameConfig>,
```

This is type-only, with no runtime change. Line 270 already passes the value straight through `clampGameConfig`, which is documented as "Tolerant by design: unknown fields are ignored and missing fields fall back to the default game". The declared `GameConfig` was never accurate — the test at line 67 has always passed a three-field partial. Widening it is what lets Step 4 stay honest instead of casting.

- [ ] **Step 4: Fix the coordinator test's `satisfies` clause**

`server/src/matchCoordinator.test.ts`. Remove `type MatchRules,` from the `@hidden/game-core` import at line 7 and add `type GameConfig,` in its place. Then at lines 67-71:

```ts
    const proposedConfig = {
      rounds: 999,
      turnSeconds: 0,
      blindMode: false,
    } satisfies Partial<GameConfig>
```

- [ ] **Step 5: Delete the three vacuous assertions**

`server/src/matchCoordinator.test.ts`. Delete lines 161, 163, and 164:

```ts
    expect(start.run.spec.rules).toBe(pairedRoom.rules)
    expect(Object.isFrozen(start.run.spec.mode)).toBe(true)
    expect(Object.isFrozen(start.run.spec.rules)).toBe(true)
```

**Keep line 162**, `expect(Object.isFrozen(start.run.spec)).toBe(true)` — that one is real and guards `freezeSpec`.

The three deleted lines read properties that do not exist on `ResolvedGameSpec` or on `MatchRoom`, so they compare `undefined` to `undefined` and call `Object.isFrozen(undefined)`, which returns `true`. The `toEqual` on lines 155-160 already asserts the spec's full contents, so no coverage is lost.

- [ ] **Step 6: Delete the dead web module and its test**

```bash
git rm web/src/game/matchRules.ts web/src/game/matchRules.test.ts
```

Confirm nothing else imported it:

```bash
grep -rn "game/matchRules\|from './matchRules'" web/src
```

Expected: no output.

- [ ] **Step 7: Run the server and web suites**

```bash
npm run test:server && npm run test:web
```

Expected: PASS. The server suite has one file fewer, the web suite one fewer.

- [ ] **Step 8: Commit**

```bash
git add -A server/src web/src
git commit -m "refactor: delete the dead matchRules modules in server and web"
```

---

### Task 4: Full verification and roadmap update

**Files:**
- Modify: `docs/ROADMAP.md:41-58`

**Interfaces:**
- Consumes: Tasks 1-3 complete and committed.
- Produces: a repo where `npm test`, `npm run build`, and `npm run lint` all pass, and `docs/ROADMAP.md` no longer lists a finished task as next up.

- [ ] **Step 1: Prove the symbols are gone from source**

```bash
grep -rn "MODE_REGISTRY\|CLASSIC_V1\|ModeRegistry\|ModeRef\|MatchRules\|resolveSpec\|decodeMatchRules\|clampMatchRules\|DEFAULT_MATCH_RULES" packages server web --include=*.ts --include=*.tsx
```

Expected: the **only** matches are `MatchRulesSummary` in `web/src/App.tsx`, `web/src/components/PregameUi.tsx`, and `web/src/components/__tests__/PregameUi.test.ts`. That is the React component and it stays. Anything else is a miss — go fix it before continuing.

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: PASS — lockfile, core, web, server.

- [ ] **Step 3: Build both packages**

```bash
npm run build
```

Expected: PASS. This is the real typecheck gate for the web package, whose `tsconfig.app.json` includes `src` and so typechecks the test files that Task 1 Step 6 migrated. A failure here means a legacy `{ mode, rules }` call site was missed.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: PASS with no new warnings.

- [ ] **Step 5: Update the roadmap**

In `docs/ROADMAP.md`, delete the "### 1. Delete the mode registry and MatchRules" section at lines 43-57 and renumber the remaining items: "Match history and replay" becomes 1, "Simultaneous conflict resolution" 2, "Match durability and reconnect" 3, "Horizontal scaling" 4. Update the `Last reviewed:` date at line 3 to `2026-08-04`.

In the "Match durability and reconnect" section, the sentence "Sequenced after replay on purpose" still refers to a section by name, not by number, so it needs no edit. Check for any other cross-reference to item numbers before committing.

- [ ] **Step 6: Add a journal entry**

Append to `docs/JOURNAL.md`, matching the format of the entries already there:

```markdown
## 2026-08-04 — Mode registry and MatchRules deleted

`GameSpec` is now a required `{ engine, config, seed, firstSeat }` and the
legacy `{ mode, rules }` shim in `createGame` is gone, along with `ModeRef`,
`ModeRegistry`, `MODE_REGISTRY`, `CLASSIC_V1`, `MatchRules`,
`DEFAULT_MATCH_RULES`, `decodeMatchRules`, and `clampMatchRules`.

Three things surfaced that the roadmap had not recorded: `app.test.ts` and
`coreAdapter.test.ts` were still building canonical state through the legacy
shape and passing only because the shim fell back to defaults; three
assertions in `matchCoordinator.test.ts` were reading properties that do not
exist on `ResolvedGameSpec` and so were vacuously true; and
`web/src/game/matchRules.ts` was dead, imported by nothing but its own test.

Engine revision deliberately unchanged — no placement, scoring, or RNG
behaviour was touched.
```

- [ ] **Step 7: Commit**

```bash
git add docs/ROADMAP.md docs/JOURNAL.md
git commit -m "docs: record the mode registry deletion and renumber the roadmap"
```

---

## Optional Task 5: Rename `server/src/matchRules.ts` to `gameConfig.ts`

**Only do this if the user approves it.** It is not part of the roadmap item, and it touches three files that otherwise stay untouched.

After Task 3, `server/src/matchRules.ts` is a module named for a type it no longer exports. The honest name is `gameConfig.ts`.

**Files:**
- Rename: `server/src/matchRules.ts` → `server/src/gameConfig.ts`
- Modify: `server/src/app.test.ts:10`, `server/src/gameHandler.ts:9`, `server/src/protocol.ts:8`

- [ ] **Step 1: Rename the file**

```bash
git mv server/src/matchRules.ts server/src/gameConfig.ts
```

- [ ] **Step 2: Update the three importers**

Change `from './matchRules'` to `from './gameConfig'` in `server/src/app.test.ts:10`, `server/src/gameHandler.ts:9`, and `server/src/protocol.ts:8`.

- [ ] **Step 3: Verify no importer was missed**

```bash
grep -rn "matchRules" server/src
```

Expected: no output.

- [ ] **Step 4: Test and build**

```bash
npm run test:server && npm run build:server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A server/src
git commit -m "refactor(server): rename matchRules module to gameConfig"
```
