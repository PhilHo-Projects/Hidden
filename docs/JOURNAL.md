# Hidden journal

Newest first. One entry per stretch of work. Keep entries short — the git log
holds the detail, and this file exists so nobody has to read a 1,600-line plan
to learn what happened.

## 2026-08-09 — Durable static match history

Completed online matches now survive deploys without committing the project to
a replay format while mechanics are unstable.

- PostgreSQL stores a versioned, idempotent final record keyed by the match UUID:
  participant name snapshots, engine/config identity, scores, winner, and both
  symbol-only final boards. Guests are recorded; offline and abandoned games are
  not. Account deletion keeps the historical username snapshot.
- `MatchCoordinator` emits completion once. The recorder writes off the game-over
  path, makes three total attempts, caps work at four concurrent and 256 pending
  writes, logs no payloads, and drains admitted writes during graceful shutdown.
- Signed-in participants can browse perspective-correct W/L/T totals and
  newest-first pages, open final-board detail, and maintain independent
  **Interesting** bookmarks. Guests get 401 and nonparticipants get 404.
- The profile menu now opens a responsive ledger with explicit loading, empty,
  expired-session, retry, pagination, detail, and bookmark-rollback states.
  Unknown future symbols render as text.
- Quick Match and hosted rooms reject a second connection authenticated as the
  same account, so one account cannot create an unpersistable two-seat record.

Verified with a real PostgreSQL 16-backed six-round online match: the two
accounts saw loss 0–6 and win 6–0 respectively, final boards matched, one
bookmark did not leak to the opponent, and a third account could not access the
record. Replay arrows, commands/timing, admin-global browsing, cleanup, R2, and
deployment remain deliberately deferred.

## 2026-08-06 — Repository cleanup

No runtime behaviour changed. The server's shipping code is byte-identical;
only its tests moved. Net −456 lines across 48 files.

- Deleted `web/src/game/engine.ts`, the pre-`game-core` client engine. `App.tsx`
  imported one five-line function from it; its other ten exports were reachable
  only from its own test file. It hardcoded a 9-cell grid and a 3×3 win table,
  so it had been wrong for every board size since rules became config.
- Presentation state now carries `ClassicSymbol` instead of a hex `PaintColor`,
  deleting both symbol↔colour translation maps. Colour is resolved at the render
  boundary and pinned by a test; the wire still spells moves `green`/`blue`/`red`.
- Renamed the `unity-` class and variable namespace to `hidden-`. Anchored to
  `\bunity-`, because `handleImmunity` and `@eslint-community` both contain the
  substring.
- Packet ids are grouped LIVE / LEGACY / RESERVED. Legacy decode branches stay:
  `NetworkClient` turns any decode failure into a terminal sync-lost.

**Two findings worth keeping.** `packages/game-core` and `server` excluded
`*.test.ts` from tsconfig — load-bearing for emit, since without it `npm run
build` compiles tests into `dist/` and ships them, but it also meant neither
suite was ever typechecked. Adding a `noEmit` typecheck config surfaced ten
errors, one of which was `expect(rematch.run.spec.rules).toBe(...)` — a property
deleted with the mode registry, comparing `undefined` to `undefined`, passing
for months.

And tests could not have caught the `unity-` rename: the only two suites that
mention the prefix assert `not.toContain`, so they pass harder once it is gone.
A class renamed in CSS but not markup gives unstyled UI with a green suite. That
one was verified in a browser, not by the suite.

## 2026-08-05 — Mode registry and MatchRules deleted

The last unfinished item from the parameterization work. `GameSpec` is now a
required `{ engine, config, seed, firstSeat }` and the legacy `{ mode, rules }`
shim in `createGame` is gone, along with `ModeRef`, `ModeRegistry`,
`MODE_REGISTRY`, `CLASSIC_V1`, `MatchRules`, `DEFAULT_MATCH_RULES`,
`decodeMatchRules`, and `clampMatchRules`.

Done in two phases so every commit stays green: migrate all callers off the
legacy shape while the shim still accepts both, then delete.

Three things surfaced that the roadmap had not recorded:

- `app.test.ts` and `coreAdapter.test.ts` were still building canonical state
  through the legacy shape. In `app.test.ts` the local descriptor type has no
  `mode` or `rules` field, so both read `undefined` and the test passed only
  because the shim fell back to the defaults.
- Three assertions in `matchCoordinator.test.ts` read `.rules` and `.mode` off
  a `ResolvedGameSpec` and a `MatchRoom`, neither of which has them. They
  compared `undefined` to `undefined` and called `Object.isFrozen(undefined)`,
  which is `true`. They had never tested anything.
- `web/src/game/matchRules.ts` was dead, imported by nothing but its own test.

Worth noting why that rot survived: `packages/game-core/tsconfig.json` and
`server/tsconfig.json` both exclude `src/**/*.test.ts`, so core and server
tests are never typechecked. Only `web` typechecks its tests.

Engine revision deliberately unchanged — no placement, scoring, or RNG
behaviour was touched.

## 2026-08-04 — Private lobby

Create Game and Find Game work. Any player can host, guests included.

- Server carries `GameConfig` end to end. `MatchRoom`, the matchmaking packet,
  and `GameStartDescriptor` all use it; the descriptor sends `engine + config`
  instead of a mode reference.
- Added a pending-game registry keyed by a 5-character join code, and packets
  21–27. The public list is a filtered read over the same map, so listed and
  code-only games are one feature. Joining hands both players to the existing
  `createRoom`, so match handling and the ready/start flow are unchanged.
- Host disconnect clears the entry and pushes a fresh list.
- The Create screen's rules panel is **ungated**. Quick Match stays admin-only
  because a proposal there binds a stranger; a host owns their own game's rules.

Verified by driving two real browser tabs against the running server: a public
5×5 no-power-up game was listed, joined, and played; a private 4×4 game stayed
out of the list and was reached by code, rendering 16 cells in 4 columns with no
power-up tray.

**Bug found by doing that, not by tests:** `createOnlineMatchConfig` still
cherry-picked `rounds`/`turnSeconds`/`blindMode` and defaulted the rest, so an
online match's presentation config disagreed with its engine — correct board,
wrong power-up tray. All 114 web tests passed with the bug present.

Not done: deleting the mode registry and `MatchRules`. See ROADMAP item 1.

## 2026-08-03 — Rules became data

Replaced the versioned mode registry with a versioned **engine** plus a
per-match `GameConfig`. Rule variants now cost no code change.

- `createTopology(boardSize, streak)` generates board topologies. Guarded by a
  test asserting `createTopology(3, 3)` reproduces the original 3×3 exactly,
  pattern order included, so the change provably did not alter the game.
- `GameConfig` holds every knob. Decoding is tolerant per field: a malformed
  value falls back on its own instead of discarding the whole proposal, so a
  stale client degrades to the default game rather than failing to join.
- Power-up master switch, per-power-up toggles, and `forbidImmediateRepeat`
  (the fix for the contested-cell loop) all became config, not code.
- `BoardGrid` derives its column count from the cell count, so every board size
  renders without threading size through call sites.
- Offline practice exposes all ten knobs.

Two findings worth remembering:

- `winningPatterns` is **not** the win condition. It is only the power-up unlock
  trigger. The win condition is "most surviving cells" in `finishGame`. With
  power-ups off, line patterns do nothing.
- Board size and round count are one knob, not two. Density is the real
  variable: 6 rounds fills 67% of a 3×3 but 24% of a 5×5, where players mostly
  miss each other and tie.

Also fixed a **pre-existing** break: `npm run dev` never mounted React, silently
and with no console error, because `game-core` emits CommonJS and Vite leaves
linked workspace packages unbundled. The production build was never affected.

## Earlier

Server-authoritative match cycle, online match rules authority, and accounts.
See `superpowers/plans/archive/` and the git log.
