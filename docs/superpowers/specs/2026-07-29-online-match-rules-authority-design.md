# Online Match Rules Authority Design

## Purpose

Make the server the only authority on the ruleset an online match runs under,
and let an administrator choose that ruleset for matches they play in. This
fixes a live desynchronisation bug and gives balance changes a fast test loop
against a real opponent instead of only against the bot.

## The bug being fixed

`GAME_START` carries only `firstPlayerId` (`server/src/gameHandler.ts`). The
client therefore falls back to its own local settings when an online match
begins (`web/src/App.tsx`, the `game-start` branch reads `settingsRef.current`
for `rounds`, `turnSeconds`, and `blindMode`).

Those settings are App-level state that survives navigation, and the Advanced
panel that edits them lives on the offline setup screen. So this sequence
desynchronises a match:

1. Open Offline, expand Advanced, change Rounds from 6 to 3, press Back.
2. Go Online and start Quick Match.
3. The match ends after 6 turns on this client and never ends on the opponent's,
   because their `maxTurns` is still 12.

A `blindMode` mismatch desynchronises the same way: one player sees the
opponent board and the other does not. This is the most likely cause of the
reported match that finished for one player and hung for the other.

Online `AGAIN?` is broken by the same root cause. It calls `beginCountdown`
locally with `isMyTurn` hard-coded to `true` and sends nothing to the server, so
both players start a fresh local match each believing they move first.

## Scope boundary

In scope:

- A shared match-rules shape with defaults and clamping.
- Server-resolved rules delivered with `MATCH_FOUND`.
- An administrator role derived from server configuration.
- An admin-only rules panel on the online menu.
- The ruleset shown on the ready screen before either player readies.
- Online rematch routed through the existing ready handshake.

Out of scope, each its own later spec:

- Variable board size beyond 3x3.
- Generalising the three-way beats comparison to N types.
- Reworking what colour communicates versus what the symbol communicates.
- Administrator observability: log streaming and match-state inspection.

Bot play is unchanged. It keeps reading the local Advanced panel directly,
because there is no second client to disagree with.

## Match rules

```
MatchRules {
  rounds: number
  turnSeconds: number
  blindMode: boolean
}
```

`DEFAULT_MATCH_RULES` is `{ rounds: 6, turnSeconds: 10, blindMode: true }`,
matching the current client defaults. `clampMatchRules` pins `rounds` to 1-20
and `turnSeconds` to 2-60, the bounds the existing Advanced inputs enforce, and
coerces anything non-numeric to the default for that field.

The shape, the defaults, and the clamp are defined once per package: in
`web/src/game/` and in `server/src/`. `PacketType` is already mirrored across
both packages the same way; following that convention is preferable to
introducing a workspace for three fields.

On the wire the ruleset is a MessagePack map keyed by field name, not a
positional array. Spec 3 adds `boardSize` and later specs add more; a map lets
those arrive without disturbing how existing fields decode.

## Server

### Configuration

`resolveAdminUsernames(value)` joins `server/src/serverConfig.ts` beside
`resolveAllowedOrigins`, reading `ADMIN_USERNAMES` as a comma-separated list.
Each entry is trimmed and lower-cased so it matches the `usernameKey` that
`parseCredentials` derives in `server/src/auth/password.ts`; admin matching is
then case-insensitive in exactly the way login already is.

An absent or empty value yields an empty set, including in production. A fresh
deployment has no administrator until one is configured deliberately. Unlike
`ALLOWED_ORIGINS` and `DATABASE_URL`, a missing value is not an error.

No database migration is required. The role is derived from configuration at
authentication time, so there is no schema change and no stored value that can
drift from the allowlist. A `users.role` column would only earn its place if
administrators had to be granted without a redeploy, and editing a Coolify
environment variable is itself a redeploy.

### Role resolution

`AuthUser` in `server/src/auth/repository.ts` stays as it is. It describes a
persisted row, and the role is not persisted.

`AuthService` takes the admin username set and exposes
`AuthenticatedUser = AuthUser & { role: UserRole }`, where `UserRole` is
`'player' | 'admin'`. `register`, `login`, and `getSession` each map their
result through one private `withRole` helper; `getSession` passes `undefined`
through unchanged. The repository keeps its single responsibility of
persistence, and there is exactly one place where a role is decided.

`AuthServiceLike` in `server/src/app.ts` widens to match. The identity built
during the WebSocket upgrade already spreads from the session user, so `role`
reaches the socket once the service returns it. `ClientIdentity` in
`server/src/gameHandler.ts` gains `role`.

`/api/auth/session`, `/api/auth/login`, and `/api/auth/register` return `role`
so the client knows whether to render the admin panel. This is a rendering hint
only; every server-side decision re-checks the session's own role.

A guest is never an administrator. The role comes from an authenticated account
or it does not exist, and nothing inside a packet can influence it. This follows
the project rule that the connection-assigned identity is authoritative and a
sender-supplied value is not.

### Game handler

`ClientSession` gains `role` and `proposedRules?: MatchRules`. `Match` gains
`rules: MatchRules`.

`MATCHMAKING_REQUEST` accepts an optional trailing rules map. Appending an
element is backward compatible on the wire, and no packet number changes, so
the protocol rule that active numbers are fixed still holds. The client and
server ship in the same container, so the two sides never skew in deployment.

`updateMatchmaking` stores a decoded proposal on the session only when that
session's role is `admin`. A proposal from any other session is discarded. Each
search request overwrites any previous proposal, and leaving the queue clears
it, so a stale ruleset can never outlive the search that carried it.

`tryCreateMatch` resolves the ruleset once, when the match is created:

1. Collect the proposals held by the two matched players, in queue order.
2. Take the first one, or `DEFAULT_MATCH_RULES` if there is none. Both players
   being administrators with differing proposals therefore resolves to the
   earlier queue entry. `matchmakingQueue` is a `Set`, which iterates in
   insertion order, so this is deterministic rather than incidental.
3. Clamp the result.
4. Store it on the `Match` and send it with `MATCH_FOUND` to both players.

Both players always receive byte-identical rules, because there is one resolved
value and it is sent from one place.

### Rematch

The server already supports this. `updateReadyState` clears `match.ready`
immediately after emitting `GAME_START`, and the match stays in `matches` until
a player disconnects or leaves the room. A second round of `READY` from both
players therefore re-emits `GAME_START` with a freshly drawn first player.

A rematch reuses the rules stored on the `Match`. Changing rules between matches
means re-queueing, which is acceptable: it is one extra screen and it keeps the
resolved ruleset immutable for the lifetime of a match, so a mid-match rules
change can never be the cause of a desynchronisation.

## Client

`AuthUser` in `web/src/auth/authClient.ts` gains `role`.

`NetworkClient.startMatchmaking` takes an optional `MatchRules`, sent only when
the signed-in account's role is `admin`. The `match-found` client event carries
the resolved rules.

In `App.tsx`:

- The rules from `match-found` are held in a ref, so the `game-start` handler
  reads them without being rebuilt and without re-subscribing the socket.
- The `game-start` branch stops reading `settingsRef.current` for online
  matches. This deletion is the bug fix.
- If rules are somehow absent, fall back to `DEFAULT_MATCH_RULES`, never to
  local settings. Falling back to local settings is the defect.
- The ready screen renders the resolved ruleset, so a mismatch would be visible
  rather than silent.
- The online menu shows the existing `AdvancedSettings` component when the
  account's role is `admin`.
- `AGAIN?` on an online match sends ready and returns to the ready screen.
  Offline keeps its immediate local restart.

## Failure behaviour

Nothing in this change disconnects a client. The existing path where a
`ProtocolError` closes the socket stays reserved for packets that cannot be
parsed at all, which is what it is for today.

- Rules from a non-admin session: discarded, logged at `debug`. A stale or
  modified client is not a reason to kick a player mid-session.
- Malformed or partially-typed rules map: treated as absent, defaults used.
- Values outside the accepted range: clamped, not rejected. A hostile client
  cannot create a 10,000-round match.
- Rules missing from `MATCH_FOUND`: client uses `DEFAULT_MATCH_RULES`.

Logging stays within the existing convention: structured events only, and no
raw packet bodies at `info`.

## Testing

Server:

- Rules sent by a non-admin session are ignored and the match uses defaults.
- Rules sent by an admin session are applied.
- Out-of-range values are clamped: `rounds: 999` becomes 20, `turnSeconds: 0`
  becomes 2.
- Both players receive identical rules in `MATCH_FOUND`.
- A malformed rules payload does not close the socket and does not change the
  resolved ruleset.
- An empty or absent `ADMIN_USERNAMES` yields no administrators.
- Admin matching is case-insensitive and uses the same normalisation as login.
- Two admins with different proposals resolve to the earlier queue entry.
- A second `READY` round after a finished match re-emits `GAME_START`.

Client:

- `game-start` uses the rules received from the server and not local settings.
  This is the direct regression test for the reported hung match.
- The ready screen renders the resolved ruleset.
- Online `AGAIN?` sends ready rather than starting a local match.
- The admin panel is absent for a guest and for a non-admin account.

Per project rule, tests are written before the runtime behaviour changes.

## Deployment

One new environment variable, optional everywhere:

```
ADMIN_USERNAMES=Ecco
```

The account itself is registered through the normal signup screen with a
password the operator chooses. No credential is committed, generated by
tooling, or recorded in project history. Revoking administrator access is an
edit to this variable, and granting it to an additional account is a comma.
