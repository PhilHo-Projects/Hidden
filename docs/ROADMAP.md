# Hidden roadmap

Last reviewed: 2026-08-04.

Read this file to know where the project stands and what to do next. History
lives in [JOURNAL.md](JOURNAL.md); finished plans are in
`superpowers/plans/archive/` and are not worth reading.

## What this project is right now

Hidden is not a finished game and its rules are not yet known to be good. The
near-term goal is **not shipping features** — it is being able to try rule
variants cheaply until one is worth keeping.

Everything below serves that. A feature that does not help answer "is this
version more fun?" is not a priority.

## Current state

- Live at `https://hidden.philippeho.dev`. One replica, process-local state.
- Rules are data. `GameConfig` carries board size, streak length, rounds, turn
  seconds, blind mode, power-up toggles, and the no-repeat-cell rule. It is
  stored on the match and sent over the wire.
- Versioning is on the **engine** (`ENGINE_ID` / `ENGINE_REVISION`), not on
  variants. Bump it only when placement resolution, scoring, or the RNG
  changes — never when a board or a toggle changes.
- Offline practice exposes every knob. Online matches carry the host's config.
- Create Game / Find Game work. Any player can host, guests included. Public
  games appear in a list; private games are reachable by a 5-character code.
- Accounts and sessions persist in PostgreSQL. **Nothing about matches
  persists.** A deploy or restart destroys in-progress matches.

## The one rule that must not be broken

Never edit a published engine revision's behaviour in place. A stored match is
reconstructable from `engine revision + config + seed + ordered commands`. The
config travels with the match, so board and toggle changes are safe. Changing
how the engine resolves placements without bumping the revision would make
every past match silently replay into a different game.

## Next up

### 1. Delete the mode registry and MatchRules

The only unfinished item from the parameterization work. `packages/game-core`
still exports `ModeRef`, `ModeRegistry`, `MODE_REGISTRY`, `CLASSIC_V1`,
`MatchRules`, `DEFAULT_MATCH_RULES`, `decodeMatchRules`, and `clampMatchRules`,
plus a `resolveSpec` shim in `createGame` that accepts the legacy
`{ mode, rules }` spec shape.

Nothing in the runtime path uses any of it. A few tests still do. Make
`GameSpec` non-optional `{ engine, config, seed, firstSeat }` and delete the
shim.

Keep the `createTopology(3, 3)` test that asserts the legacy 3x3 pattern order
— it uses a literal, not `CLASSIC_V1`, and it is the guard that the original
game still plays identically.

### 2. Match history and replay

The hard prerequisite is already delivered: matches are deterministic from
seed plus commands, and every match has a UUID and an engine revision.

Deliberately ephemeral for now. No database work:

- On match completion the server sends a `MATCH_RECORD` packet carrying
  `{ matchId, engineRevision, config, seed, firstSeat, commands, result }`.
- `commands` must include server-generated `timeout` commands with their acting
  seat. `applyTimeout` consumes the seeded RNG, so omitting them desynchronises
  reconstruction.
- The client keeps the last ~20 records in `sessionStorage`. Lost on deploy and
  on closing the tab, which is intended.
- The review screen replays through the same core with both boards revealed.
- **"Try from here"** hands the reconstructed state at turn N to the offline
  practice path, so a hypothetical is played out rather than argued about.

Durable, deploy-proof history is a later concern, and only worth building once
the rules are settled.

### 3. Simultaneous conflict resolution

Conflicts resolve at placement time today, so placing on a contested cell
instantly reveals that it was contested. That information leak is what the
known degenerate loop feeds on.

Buffering both placements and resolving at round end is the principled fix, but
it restructures turn flow and collides with `extraTurn` and shield timing.
`forbidImmediateRepeat` is the cheap partial mitigation and already ships.

Play real games with it on before deciding this is worth the rebuild.

### 4. Match durability and reconnect

Every deploy, restart, or network drop destroys in-progress matches. Real, but
low: a match runs about two minutes, so an interrupted one is cheap to abandon.

Sequenced after replay on purpose. Persisting matches and their command streams
turns "survive a restart" into "load unfinished matches on boot", which is far
cheaper than building durable match state on its own.

Client-level reconnect, where the process still holds the room, is independent
and can be done any time as a UX improvement.

### 5. Horizontal scaling

Needs shared matchmaking and match state first. Do not raise the replica count
before that exists. Raising `MAX_CONNECTIONS` on the single replica is the
cheap intermediate step. Throughput is not the near-term risk.

## Deferred experiments

Non-square and irregular topologies (hex, Tetris-shaped, Catan-like). The
config shape leaves room for them: `createTopology` is the only thing that
assumes a square board. Not worth building until a square variant is fun.

## Operational constraints

Measured on 2026-08-03 unless noted.

| Constraint | Value | Notes |
| --- | --- | --- |
| `MAX_CONNECTIONS` | 100 | Default, env-overridable, unset in production. Caps play at 50 concurrent matches. |
| Container memory cap | 256 MiB | ~30 MiB idle. |
| Host | 2 vCPU, 3.7 GB RAM | Shared with ~18 other containers. |
| Rate limit | 30 msg/sec/connection | Plus a 16 KiB payload ceiling. |
| WebSocket compression | disabled | `ws` default. Keeps per-connection memory low. |
| Command cache | 128 entries per seat | Bounded; rooms and timers deleted on cleanup. |

Estimated, not load-tested: roughly 1,000–2,000 concurrent connections before
this host is the limit.

## Local development

`web/`'s dev server needs `optimizeDeps.include: ['@hidden/game-core']` because
that package emits CommonJS and Vite leaves linked workspace packages
unbundled. Without it the page loads, React never mounts, and **no console
error is printed**. If you ever see a blank app with a clean console, check
that first.

Two-player testing: build and start the server (`npm run build && npm start` in
`server/`), run `npm run dev` in `web/`, open two tabs. Vite proxies `/api` and
`/ws` to port 8080. No database needed — the server logs
`auth.disabled_guest_only` and guests can play online.

If the server rejects packets as invalid, check for a stale `node dist/server.js`
still holding port 8080 from an earlier build.
