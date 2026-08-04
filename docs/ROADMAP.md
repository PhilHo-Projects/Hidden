# Hidden roadmap and operational backlog

Last reviewed: 2026-08-03, after `e92f0ca` (PR #4) reached production.

This supersedes the inline roadmap in
`docs/superpowers/specs/2026-08-01-server-authoritative-match-cycle-design.md`,
which is a point-in-time spec and is not updated here.

## Current production state

- Live at `https://hidden.philippeho.dev` (Coolify application id 12).
- One replica. Matchmaking and match state are process-local and in-memory.
- Online Quick Match is fully server-authoritative: the server owns board
  state, turn order, power-ups, deadlines, scoring, and completion.
- Offline practice and online play share one deterministic `@hidden/game-core`.
- Accounts and sessions persist in PostgreSQL. Nothing about matches persists.

## Operational constraints found on 2026-08-03

These were measured or read from the deployed configuration, not estimated
unless stated.

| Constraint | Value | Notes |
| --- | --- | --- |
| `MAX_CONNECTIONS` | 100 | Default; env-overridable, unset in production. Caps play at 50 concurrent matches. |
| Container memory cap | 256 MiB | Currently using ~30 MiB idle. |
| Host | 2 vCPU, 3.7 GB RAM | Shared with ~18 other containers; load average ~0.6. |
| Rate limit | 30 msg/sec/connection | Plus a 16 KiB payload ceiling. |
| WebSocket compression | disabled | `ws` default. Keeps per-connection memory low; do not enable casually. |
| Command cache | 128 entries per seat | Bounded. Rooms and timers are deleted on cleanup. |

Estimated, not load-tested: roughly 1,000-2,000 concurrent connections before
this host becomes the limit. Throughput is not the near-term risk.

## Backlog, in recommended order

### 0. Cross-cutting decision: durable player identity

This is the only real prerequisite shared by the items below, and it is small.

Guest names are generated per page load (`useState(createGuestName)` in
`web/src/App.tsx`) and stored nowhere. Accounts persist; guests do not. Before
match rows are written, decide whether guest matches are recorded at all, and
if so give guests a stable token. Deciding late means a schema migration.

Settle this as part of match history design (item 3), not before it.

### 1. Parameterize the game — the design testbed

The near-term goal is not shipping features, it is being able to test variants
of the core idea: different board sizes and shapes, power-ups on or off,
different turn lengths. The current game is not yet fun and cannot be fixed
without a way to try alternatives.

Already data-driven and reusable:

- `topology` is `{ locationIds, winningPatterns }`. Win detection loops over
  `winningPatterns` generically; nothing in the engine hardcodes 3x3.
- `powerupBySymbol` maps symbols to power-ups as data.
- `BoardGrid` maps over `grid.cells` without assuming a count.

Blocking work:

- `ModeRegistry` is typed `Record<'classic@1', ClassicMode>`, and `ClassicMode`
  pins `id: 'classic'` and `revision: 1` as literal types. Widen to admit more
  modes.
- The mode is hardcoded in five places: `matchCoordinator.ts`,
  `web/src/game/coreAdapter.ts`, and `web/src/game/protocol.ts` (x3).
- `MatchRules` is only `{ rounds, turnSeconds, blindMode }`. Needs a mode
  selector and power-up toggles.
- `.unity-board-grid` in `web/src/index.css` hardcodes
  `grid-template-columns: repeat(3, ...)`.

Do this first because offline practice already exposes full parameter control
and runs the identical core. Parameterizing first makes variants testable solo
against the bot immediately, without waiting on a lobby or a second player.

### 2. Private games — route Create/Find Game through the room factory

`createRoom()` is already public and discovery-agnostic; Quick Match is just
one caller. Remaining work:

- A pending-code registry mapping a join code to the waiting creator.
  `createRoom()` needs both participants at once, so the creator waits outside
  a room until a joiner arrives.
- Two appended packet IDs (21+). Never renumber an active ID.
- UI behind the two `Coming soon` buttons.
- Decide who sets rules for a private game. Quick Match currently uses the
  first queuer's proposal.

### 3. Match history and replay

The hard prerequisite is already delivered: every match has a UUID, a uint32
seed, a mode revision, and an ordered command stream with monotonic revisions,
and the core is deterministic, so seed plus commands fully reconstruct a match.
`accountId` is already carried on every participant.

Missing entirely:

- No match schema. Only `users` and `sessions` tables exist.
- No write path. `MatchCoordinator` performs zero database work; domain events
  are broadcast and then discarded.
- Guests have no durable identity, so guest matches cannot be attributed.

### 4. Match durability and reconnect

State is process-local and there is no reconnect, so every deploy, restart, or
network drop destroys in-progress matches. This is a real defect but a low one:
matches run about two minutes at the default 6 rounds x 10s, so an interrupted
match is cheap to abandon and re-queue. Match history can record it as
abandoned rather than pretending it finished.

Deliberately sequenced after match history. Persisting matches and their
command streams for history turns "survive a server restart" into "load
unfinished matches on boot and rehydrate", which is far cheaper than building
durable match state on its own.

Client-level reconnect (the process still holds the room) is independent of
persistence and can be done at any point as a UX improvement.

### 5. Horizontal scaling

Requires shared matchmaking and match state before a second replica is
possible. Do not raise the replica count before this exists. Raising
`MAX_CONNECTIONS` on the single replica is the cheap intermediate step.

### 6. Deferred experiments

Versioned balance variants and hex or irregular topologies, once item 1 has
made modes additive. Anything here that turns out to be needed for design
testing should be pulled forward into item 1 instead of waiting.

## Documentation debt

- `DESIGN.md` still states that accounts are not implemented. Accounts shipped
  in PR #1.
