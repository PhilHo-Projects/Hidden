# Hidden roadmap

Last reviewed: 2026-08-09.

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
  seconds, blind mode, and power-up toggles. It is stored on the match and sent
  over the wire. Two are no longer player-facing: desecrated tiles are
  unconditional, so there is no flag, and `streak` now defaults to a full line
  for the board.
- `streak` only ever set how long a line must be to **unlock a power-up** —
  `winningPatterns` is read in exactly one place, `maybeUnlockPowerup`. It was
  labelled "Line to win", which no rule does. The control is gone and the value
  rides board size. Revisit when power-up unlocking is redesigned; loot or
  currency toward a purchase is the idea on the table.
- The turn timer goes down to 0.2s offline so a bot match resolves in seconds.
  Online is floored at 2s in three places: the server clamp, the client's packet
  decode, and the host panel's minimum.
- Versioning is on the **engine** (`ENGINE_ID` / `ENGINE_REVISION`), not on
  variants. Bump it only when placement resolution, scoring, or the RNG
  changes — never when a board or a toggle changes.
- Offline practice exposes every knob. Online matches carry the host's config.
- Create Game / Find Game work. Any player can host, guests included. Public
  games appear in a list; private games are reachable by a 5-character code.
- Accounts, sessions, and completed online-match snapshots persist in
  PostgreSQL. Active matches and matchmaking are still process-local, so a
  deploy or restart destroys games that have not finished.

## The one rule that must not be broken

Never edit a published engine revision's behaviour in place. A future replay
record is reconstructable from `engine revision + config + seed + ordered
commands`. The config travels with the match, so board and toggle changes are
safe. Changing how the engine resolves placements without bumping the revision
would make every command-bearing replay silently reconstruct a different game.
Static history v1 deliberately stores no seed or commands and makes no replay
claim.

## Delivered foundation — durable static match history

Static match history and replay are now explicitly separate systems.

- Every completed online match is written once to PostgreSQL, including guest
  matches. Offline and abandoned matches are not recorded.
- The versioned v1 record holds participant name snapshots, optional account
  ownership, completion time, engine/config identity, turn count, scores, the
  winner seat, and both ordered final boards. It deliberately excludes seeds,
  commands, timing, power-up state, immunity, desecration, and other mechanical
  flags.
- Persistence is asynchronous, idempotent, retried three times, and drained on
  graceful shutdown. A history failure cannot delay game-over delivery.
- Signed-in participants get W/L/T totals, newest-first keyset pagination, final
  board detail, and private per-account **Interesting** bookmarks. Guests cannot
  browse history, and authenticated nonparticipants receive 404.
- History DTOs are separate from live game types. Unknown historical symbols
  remain visible as text instead of breaking an old result screen.
- Twenty rows is a page size, not a deletion cap. There is no v1 retention job,
  public sharing, executable replay, notes, or global admin browser.

This deliberately change-resistant snapshot is the research notebook for the
mechanics-discovery phase: a result remains readable even when the engine,
power-ups, or balance rules change later.

## Next up

### 1. Simultaneous conflict resolution

Conflicts resolve at placement time today, so placing on a contested cell
instantly reveals that it was contested.

Desecrated tiles ship as the mitigation and replaced `forbidImmediateRepeat`
outright. A destroyed cell is locked for exactly one of its owner's turns, so
the player who lost it must spend a turn elsewhere before returning. That kills
the endless trade loop, which was the part that made the leak degenerate.

The leak itself is untouched: you still learn instantly that a cell was
contested, and the inference is still bankable a turn later. Buffering both
placements and resolving at round end is the principled fix, but it restructures
turn flow and collides with `extraTurn` and shield timing.

Play real games with desecration before deciding this is worth the rebuild.
Power-ups are also meant to give the trailing player a way back in, so a
catch-up mechanic may serve the same goal more cheaply.

### 2. Match durability and reconnect

Every deploy, restart, or network drop destroys in-progress matches. Real, but
low: a match runs about two minutes, so an interrupted one is cheap to abandon.

Do not confuse the completed-result history table with active-match durability.
The former is append-only evidence after game over; the latter needs resumable
room membership, timers, command state, and boot recovery.

Client-level reconnect, where the process still holds the room, is independent
and can be done any time as a UX improvement.

### 3. Horizontal scaling

Needs shared matchmaking and match state first. Do not raise the replica count
before that exists. Raising `MAX_CONNECTIONS` on the single replica is the
cheap intermediate step. Throughput is not the near-term risk.

## Deferred systems

### Chess-style replay — after mechanics stabilize

Do not build replay arrows while the game mode and power-ups are still being
reworked. When a stable playable mode exists, introduce a new versioned replay
payload whose timeline records ordered actions, acting player, action duration,
and power-up events. Navigation is discrete chess-style previous/next actions,
not millisecond StarCraft simulation.

Timeout commands must remain explicit because `applyTimeout` consumes seeded
RNG. A later **Try from here** experiment may hand reconstructed state at action
N to offline practice, but it is not part of static history v1.

### Admin research console

After enough games exist to justify it:

- Configure the eventual two admin usernames with the existing
  `ADMIN_USERNAMES` support; do not hard-code account IDs or roles.
- Let admins browse all matches, promote examples into shared collections, and
  add research notes without changing participants' personal bookmarks.
- Show record count plus PostgreSQL table and index storage so growth is visible
  from the game instead of requiring SSH or SQL.
- Provide individual and bulk deletion of unbookmarked records with retention
  safeguards, previews, and explicit confirmation. Bookmarked/shared research
  examples must not disappear in a broad cleanup by default.

### R2 only if replay payloads become large

Keep v1 in PostgreSQL. If future command timelines become too large, create a
new private Hidden-specific R2 bucket and bucket-scoped token. PostgreSQL stays
the searchable ownership/metadata index; R2 holds only the large encrypted or
opaque payload. Never reuse another project's bucket or credentials.

## Deferred experiments

Non-square and irregular topologies (hex, Tetris-shaped, Catan-like). The
config shape leaves room for them: `createTopology` is the only thing that
assumes a square board. Not worth building until a square variant is fun.

## Codebase debt

None of this changes what the software can do, which is why it is not in "Next
up". It changes what the next change costs. Ordered by payoff.

### 1. Split the App shell

`web/src/App.tsx` is ~1600 lines. Planned in
[plans/2026-08-06-split-app-shell.md](superpowers/plans/2026-08-06-split-app-shell.md)
— **read the plan before starting, because the obvious approach is wrong.** The
render tree is already fourteen screen blocks of at most 82 lines and is not the
problem; the large hook body is, and `onClientEvent` alone is 177 lines.

The cost is blast radius rather than file length. 28 `useState` calls share one
scope, so editing one screen puts the other state within reach. Note that **game rules are
not affected** — a new rule is an edit to `game-core` plus a `FlagField` in
`ruleSchema.ts`, and touches this file not at all. The tax falls on screen,
navigation, and match-presentation work.

### 2. Split index.css

3335 lines, already clustering by component prefix. Selectors
also live in `animations/*.css` per effect, so the convention exists — this only
extends it. Vite concatenates every imported stylesheet into one file, and
`tests/fontLoading.test.ts` asserts exactly one CSS file ships, so splitting
costs nothing at runtime.

The risk is the cascade, not the build: equal-specificity rules are resolved by
source order, so files must be imported in the order their rules appeared.
Measured hazards are small — most duplicated selectors are adjacent and move
together for free. **`.results-copy` around lines 1482 and 2372 is the one that
spans distant areas**, plus 11 `@media` blocks that must stay after the
rules they override. Nothing here is caught by a test; verify in a browser.

### 3. `button-splash.png` is 412 KB

Larger than the entire JS bundle, and 37× the whole gzipped stylesheet. The
backgrounds are already WebP; the textures never got the same pass. This is the
only asset-weight item worth anyone's time.

### Explicitly not worth doing

- **Removing Tailwind.** It is imported for its preflight reset and no utility
  class is used, but the whole stylesheet is 11 KB gzipped against a ~950 KB
  page. Removing it saves ~0.3% and risks the box model on every element, since
  the CSS was written on top of that reset. Keep it, and expect to use it if the
  UI grows.
- **`immune` → `shielded`.** The shield power-up sets `LocationState.immune` and
  the packet is `IMMUNE_UPDATE`. Renaming reaches into the engine and the frozen
  protocol vocabulary for a cosmetic gain.

### Known and deliberately unfixed

`hidden-board-interactive`, `hidden-cell-occupied`, and `hidden-cell-hidden` are
applied in markup with no CSS rule targeting them. This predates the `unity-` to
`hidden-` rename. Harmless; listed so nobody rediscovers it as a bug.

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

Forcing it through the optimizer has a second consequence, and two plugins in
`vite.config.ts` exist only to contain it. Rebuilding `game-core` changes bytes
that nothing the optimizer keys on can see — the package is symlinked and pinned
at `0.0.0`, so the lockfile, version, and config hash all stay put. Vite keeps
serving the previously optimized bundle, and the browser keeps its own copy
because those responses carry `max-age=31536000, immutable`.

Both layers have to be handled: `hidden:reoptimise-linked-core` drops the dep
cache and restarts when `packages/game-core/dist/index.js` is rewritten, and
`hidden:revalidate-optimized-deps` downgrades the header so the browser cannot
serve a stale copy of the bundle Vite just replaced.

Fixing only one of the two looks like it works and does not. **The symptom is a
fresh app running a stale engine**: source files and `index.html` are never
cached, so the UI is current while the rules are whatever `game-core` last
built. It reads as a rule silently doing nothing, or as
`X is not a function` for an export added since the cached copy was written.

Two-player testing: build and start the server (`npm run build && npm start` in
`server/`), run `npm run dev` in `web/`, open two tabs. Vite proxies `/api` and
`/ws` to port 8080. No database needed — the server logs
`auth.disabled_guest_only` and guests can play online.

If the server rejects packets as invalid, check for a stale `node dist/server.js`
still holding port 8080 from an earlier build.
