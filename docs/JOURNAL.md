# Hidden journal

Newest first. One entry per stretch of work. Keep entries short — the git log
holds the detail, and this file exists so nobody has to read a 1,600-line plan
to learn what happened.

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
