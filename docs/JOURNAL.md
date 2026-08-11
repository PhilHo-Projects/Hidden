# Hidden journal

Newest first. Each entry records the problem, shipped outcome, and any lasting
constraint. Git history holds implementation detail.

## 2026-08-11 — Frontend and documentation workspace cleanup

- `App.tsx` dropped from 1,641 to 870 lines by extracting destruction, lobby,
  account, and match-session hooks; behavior and wire contracts stayed fixed.
- The 4,173-line `index.css` became an ordered feature stylesheet manifest. The
  production CSS remained byte-identical and a build test now pins one emitted
  stylesheet.
- Living docs were separated by purpose, completed plans became outcome
  summaries, and completed specs became decision records. Historical detail
  remains available in Git.

## 2026-08-10 — Read-only admin workbench

- Added a session-authorized `/api/admin` boundary for runtime counts, global
  final snapshots, and account/session aggregates.
- Added a responsive Stats/Matches/Accounts/Console dialog. Console commands are
  a client allowlist (`help`, `status`, `clear`), never shell, SQL, eval, or RPC.
- Admin roles remain derived from `ADMIN_USERNAMES`; no role or credentials are
  stored in source or exposed in DTOs.

## 2026-08-09 — Durable static match history

- Completed authoritative online matches now produce idempotent PostgreSQL final
  snapshots without delaying game-over delivery.
- Signed-in participants receive perspective-correct totals, pages, final-board
  detail, and private bookmarks; guests and nonparticipants cannot browse them.
- Snapshots deliberately omit seed, commands, and timing, so they remain
  readable research evidence rather than executable replay.

## 2026-08-07 — Desecrated tiles

- Replaced the ineffective optional no-repeat rule with an unconditional lock on
  a destroyed cell for exactly one owner turn.
- Timeouts and automatic passing respect the lock, including extra turns.
- The resolution change published classic engine revision 2. The remaining
  instant-information leak is deferred to playtesting and possible simultaneous
  resolution.

## 2026-08-06 — Navigation, onboarding, and repository cleanup

- Added the accessible How to Play modal and aligned battle typography with the
  design system without changing rules.
- Removed the obsolete client engine and symbol/colour translation layer,
  renamed the old `unity-` CSS namespace, and added test-only typechecks for
  game-core and server.
- Visual namespace changes still require browser verification; unit tests alone
  cannot prove markup and CSS stayed paired.

## 2026-08-05 — Legacy mode registry removed

- `GameSpec` became the required `{ engine, config, seed, firstSeat }` contract.
- Deleted the unused mode registry, `MatchRules` compatibility shape, dead web
  module, and vacuous tests. Engine behavior and revision did not change.

## 2026-08-04 — Hosted lobbies

- Guests and accounts can host public or code-only games carrying a complete
  `GameConfig`; join flows converge on the existing room factory.
- Added packet IDs 21-27 without renumbering active packets and verified 4x4/5x5
  hosted games in two real browser tabs.

## 2026-08-03 — Rules became data

- Replaced hardcoded variants with engine identity plus per-match `GameConfig`
  and generated square topologies for 3x3-5x5 boards.
- Offline practice gained all supported knobs and rendering became topology
  driven. The win condition remains most surviving cells; streaks unlock
  power-ups rather than deciding the winner.

## 2026-08-01 — Server-authoritative matches

- Extracted deterministic `@hidden/game-core` and made the server own trusted
  seats, canonical state, deadlines, scoring, revisions, and completion.
- Clients submit commands and apply accepted authoritative updates. Active state
  remains process-local and production remains one replica.

## 2026-07-28 — Web extraction and production cutover

- Established the React/Node web edition, hardened its container and WebSocket
  boundary, deployed it through Coolify, and archived the Unity prototype.
- The repository remains focused on the shipping web client, service, shared
  core, container, and non-shipping design lab.
