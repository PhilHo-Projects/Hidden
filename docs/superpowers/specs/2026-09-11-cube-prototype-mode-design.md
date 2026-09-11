# Cube prototype mode design

Date: 2026-09-11
Status: phased and agreed; Phase 0 not yet started.

## Purpose

A second playable variant in which the 3x3 board is one face of a cube, and
players expand onto adjacent faces during the match.

This is an experiment, not a product. It exists to answer one question: **is
territorial expansion a more interesting pressure than a single crowded 3x3
board?** Every decision below is biased toward finding that out cheaply, not
toward shipping a finished mode.

The variant is labelled **UNDER DEVELOPMENT** everywhere it is reachable. It
deploys to production deliberately so it can be played with a friend, and it
must be unmistakable that it is incomplete.

### Non-goals for every phase in this document

- No win condition. The match ends and the result screen says `TBD`.
- No cooldown / real-time play. See "The deferred fork".
- No 3D cube rendering. Navigation is a flat map plus directional arrows.
- No re-orientable net. The unfolded map is fixed.
- No match history persistence for this variant.
- No balance work. Phases 0-2 produce something playable, not something fair.

## Naming

The two variants are `main` and `prototype`. These are placeholders and are
expected to be renamed once the mode is worth naming. They appear in
`GameConfig.variant`, on the wire, and in the UI as `MAIN` and `PROTOTYPE`.

## What already generalises, and what does not

The engine is a pure reducer over serialisable data: `createGame(spec)` and
`applyCommand(state, actor, command)`. It owns no clock and no I/O; authorities
(`matchCoordinator` online, `coreAdapter` offline) own timers and call it.

`LocationId` is an opaque `number`, never a grid coordinate. Every reducer
function — `place`, `resolveConflict`, `handleImmunity`, `clearLocation`,
`beginTurn`, `isPlayable`, `hasLegalPlacement`, `finishGame`,
`maybeUnlockPowerup` — operates on IDs and on `topology.winningPatterns`, which
is data. **`createTopology` is the only function in `packages/game-core` that
knows a board is square.** The roadmap's "Deferred experiments" section already
records this; the cube is the first claim on it.

The live wire path is also ready. `GAME_COMMAND` validates `locationId` as any
non-negative safe integer with no ceiling. The `0..8` bound in
`assertBoardIndex` guards only the dead legacy `GAME_MOVE`, `GAME_MOVES`, and
`IMMUNE_UPDATE` packets. **No packet ID changes and no new packets are needed.**

Three places do assume a square board and must change:

1. `boardColumns()` in `web/src/components/BoardGrid.tsx` derives layout from
   `Math.round(Math.sqrt(cellCount))`. The renderer must be told its layout.
2. `createMatchHistoryRecord` writes `columns: config.boardSize` alongside every
   cell. A 54-cell board would record as 3 columns and render wrong.
3. `enqueueQuickMatch` pairs any two waiting players and then resolves the
   config as `first.proposedConfig ?? second.proposedConfig`. One player's rules
   silently win. With a variant that means queueing for `prototype` and landing
   in `main`.

## Why this is one engine, not two

A second engine would duplicate roughly 850 lines of reducer that the cube does
not change. Placement, RPS resolution, shields, desecration, immunity, scoring,
and power-up unlocking are all identical per face — each 3x3 face keeps the
current mechanics unchanged.

Instead, `GameConfig` gains a `variant` discriminant, `createTopology` gains a
cube sibling, and `GameState` gains face-gating state that is inert for `main`.
Estimated growth: roughly 230 lines of engine plus tests, against roughly 850
for a fork.

The TypeScript idiom here is a **discriminated union over data**, not class
inheritance, and that is load-bearing rather than stylistic:

- `GameState` travels over MessagePack and is `cloneState`d on every command. A
  class instance loses its prototype through both. Behaviour must be a pure
  function *of* data, never a method *on* data.
- With `abstract class`, adding a variant and forgetting to override a method
  silently inherits `main` behaviour. With a union plus exhaustive `switch`,
  `tsc` fails the build at every site that has not decided what the cube does.
  That is the exact bug class this mode is exposed to.

`ClassicMode` is already a strategy object carrying `topology`, `defeats`, and
`powerupBySymbol`. Swapping its data swaps behaviour. That mechanism is reused
rather than replaced.

## Engine revision: no bump

Per `2026-08-03-game-mode-testbed-design.md`, a match carries its rules verbatim
in its config, so variants are free and the engine revision is bumped only when
placement resolution, scoring, or the RNG changes.

For a `main` match nothing changes:

- Cube location IDs are `faceIndex * 9 + cellIndex`, so face 0 is `0..8` —
  byte-identical to today's 3x3.
- Cube winning patterns are emitted face by face in the existing per-face order,
  so a single-face config produces the identical pattern array, and
  `maybeUnlockPowerup`'s load-bearing "first match wins" ordering is preserved.
- Face gating never fires for `main`, whose only face is always unlocked.
- `applyTimeout` draws from the same `available` set in the same order, so the
  RNG stream is unchanged.

**`ENGINE_REVISION` stays at 2.** A golden test must assert that
`createTopology` for a `main` config produces exactly today's `locationIds` and
`winningPatterns`. That test is the safety net for this decision; if it ever
fails, the revision must be bumped instead.

## Cube geometry

Six faces, cube-intrinsic IDs so they survive a future re-orientable net:
`home`, `up`, `down`, `left`, `right`, `back`. `home` is the starting face and
`back` is opposite it.

`locationId = faceIndex * 9 + cellIndex`, `faceOf(id) = Math.floor(id / 9)`,
`cellOf(id) = id % 9`. Total 54 locations.

### Adjacency

Each face has four neighbours, named in that face's own local frame. Derived
from `home = +Z`, `up = +Y`, `right = +X`, each face viewed from outside:

| face  | N    | E     | S    | W     |
|-------|------|-------|------|-------|
| home  | up   | right | down | left  |
| up    | back | right | home | left  |
| down  | home | right | back | left  |
| left  | up   | home  | down | back  |
| right | up   | back  | down | home  |
| back  | up   | left  | down | right |

Invariants a test must assert: every face appears exactly four times as a
neighbour; adjacency is symmetric; no face neighbours itself; and the three
opposite pairs (`home`/`back`, `up`/`down`, `left`/`right`) never neighbour each
other.

The table also carries the seam rotation for each edge — how a cell index on one
face's edge maps onto the neighbouring face's edge. **Phases 0-2 do not use it**,
because all winning patterns are per-face and no line crosses a seam. It is
recorded now so that cross-face lines, if they are ever wanted, do not require
re-deriving the geometry.

### The unfolded map

The map is the Latin cross from the reference image:

```
        [ up  ]
[left ] [home ] [right]
        [down ]
        [back ]
```

**The net draws only 5 of the cube's 12 edges.** Navigation uses the full
adjacency table above, not the net, so from `up` the west arrow leads to `left`
even though the two are drawn apart. This is deliberate: the adjacency table is
about 24 entries of static data, and retrofitting true cube movement later would
mean redoing navigation, unlocking, and the map together.

The map is a display layer. It is client-only state; it never enters
`GameState`, never crosses the wire, and never affects resolution.

## Which face you are looking at is a camera, not game state

The active face is per-player view state held in the client. Two players may
look at different faces simultaneously. Putting it in `GameState` would
serialise it, send it to the opponent, and leak position information in a mode
whose whole premise is hidden boards.

## Phases

Each phase ends in something deployable and playable. Phases are ordered so the
cheapest question is answered first.

### Phase 0 — Mode plumbing

Prototype is selectable and starts a match. The match is still a single 3x3
face and plays identically to `main`. Nothing cube exists yet.

This phase exists to get the variant through every seam — config, wire,
matchmaking, lobby, offline, result screen, history gate, UI labelling — without
any gameplay change to debug at the same time.

- `GameConfig.variant: 'main' | 'prototype'`, defaulting to `'main'`.
  `clampGameConfig` falls back to `'main'` for anything unrecognised, so an
  older client that sends no variant degrades correctly.
- For `prototype`, clamp `boardSize` to 3 and default `rounds` to 12 — double
  `main`'s default of 6.
- **Matchmaking segregates on variant.** `enqueueQuickMatch` must not pair a
  `main` seeker with a `prototype` seeker. This is a correctness fix regardless
  of the cube; the existing `first ?? second` config resolution already lets one
  player's board size silently win.
- **History gate.** `finishRun` skips `onMatchCompleted` when the variant is
  `prototype`. Prototype matches are not written to PostgreSQL. The v1 record is
  the research notebook for `main`; polluting it with a mode that has no win
  condition and a board shape its renderer cannot draw is not worth it.
- **Result screen.** For `prototype`, the result panel shows `TBD` in place of
  win/loss/tie. Raw occupied-cell counts are shown beneath it, explicitly
  labelled as debug output — useful during playtesting, and not a claim about
  who won.
- **Mode selection UI.** One shared selector component, used in two places:
  - Online menu, between `HOW TO PLAY` and `QUICK MATCH`.
  - Practice / offline setup screen, inside the `PRACTICE` card.

  It sets one piece of app state that feeds quick match, pre-fills Create Game,
  and selects the offline variant. Create Game's advanced settings may override
  it. Find Game shows each listing's variant as a badge; filtering the list is
  not in this phase.
- **Under-development treatment**, all four:
  - The selector option reads `PROTOTYPE` with an `UNDER DEVELOPMENT` sub-label.
  - Selecting it shows a one-line warning: incomplete, expect bugs, no winner.
  - A persistent banner is visible for the whole match.
  - The result screen's `TBD` restates it.

### Phase 1 — The open cube

All six faces are unlocked from the first turn. No expansion *trigger*. The
player can wander the whole cube and place anywhere.

This is the first friend-testable milestone, and it answers "does a 54-cell
hidden board feel like anything at all" before any unlock logic is written.

The locked **visual treatment** does land here, on a client-side debug toggle
rather than as a rule. That gets the "can I move there?" affordance playtested a
phase early — it is the part most likely to need iteration — without Phase 1
having to gate a single placement.

- **Split `packages/game-core/src/` first, as its own commit**, before any cube
  logic lands: `config.ts` (config, clamps, constants), `topology.ts`
  (`BoardSize`, `ClassicTopology`, the grid builder, faces, adjacency, the cube
  builder), `index.ts` (the reducer, re-exporting the public API unchanged).
  The file is 858 lines today and the cube would push it past 1000. Doing the
  split separately keeps the cube diff reviewable. Other sessions land PRs on
  `main`, so rebase before starting and keep this commit small.
- Cube topology builder, face table, adjacency table, and the golden test
  asserting `main`'s topology is unchanged.
- `BoardGrid` takes its layout explicitly instead of deriving it from
  `sqrt(cellCount)`, and renders one face at a time.
- The unfolded map: cross layout, current face highlighted, faces clickable to
  jump.
- **Navigation.** Four arrows, one per side of the board, sitting outside it.
  Three input paths, all equivalent:
  - Tap or click the arrow. This is the primary path and the hit target must be
    sized for a thumb, not for the glyph.
  - Arrow keys.
  - WASD.
- **Arrow treatment.** Flat and wide rather than the chunky chevron — closer to
  a shallow curved blade than to a `^`. Dark grey, not white: these are chrome
  around the board, and the board's own white cells must stay the brightest
  thing on screen. Reduced alpha means *you cannot move there*, which is why the
  resting state cannot already be dim.

  The board's visual language is hand-cut clip-path edges and ink fills
  (`cellVariant`, `cell-ink.css`); the arrows belong to it and should read as
  torn or brushed rather than geometric. **Load the `frontend-design` skill
  before building these** — arrows and the map are the only genuinely new visual
  surface in this mode.
- **Lock state is cosmetic in this phase, and client-only.** Every face is
  genuinely unlocked; nothing rejects a placement. A debug toggle — padlock
  icon, green for open and red for locked — flips the *presentation* so the
  dimmed-arrow treatment can be looked at and iterated on, then flipped back.
  - It is **not** a `GameCommand`, does not touch `GameState`, and does not
    cross the wire. It lives next to the active-face camera, for the same
    reason: it changes what one player sees, not what is true.
  - Consequence, and it is the right one: the two players' toggles are
    independent. Either can inspect the locked treatment without disturbing the
    other's match.
  - This keeps Phase 1 free of any placement-gating risk, and means there is no
    state-mutating debug command that has to be remembered and deleted later.
    Phase 2 promotes lock state from presentation to rule; it does not have to
    dismantle anything first.
- `rounds` is double `main`'s current default — **12**, not 20. (`main` defaults
  to 6; the clamp allows up to 20 if playtesting wants more.) If the match runs
  long, lower `turnSeconds` for the variant rather than raising `rounds`.
- **Offline bot.** It draws from the engine's playable-location set, so it
  extends to 54 cells without changes to its selection logic. It will scatter
  uniformly across faces, which reads as random. Acceptable for this phase; a
  face-aware bot is not in scope.

### Phase 2 — The expansion mechanic

The match starts locked to `home`. Faces are unlocked by play rather than by the
debug button, which is deleted here.

The padlock indicator and the dimmed-arrow treatment already exist from Phase 1
as presentation. This phase promotes them to a rule: `unlockedFaces` moves into
`GameState`, the debug toggle is removed, and placement starts being gated.

- **Trigger.** The four corners of a face are cells 0, 2, 6, 8. Each edge is
  defined by its two corners: N = {0,2}, E = {2,8}, S = {6,8}, W = {0,6}.
  Holding both corners of an edge **with the same symbol** unlocks the face
  across that edge.
- **Unlock is shared.** Either player's corner pair unlocks the face for both.
  This is the central rule decision and it resolves three problems at once: no
  player can farm territory the opponent cannot reach; the map is always true
  for both players, so it needs no hidden state; and "should I expand?" becomes
  a real dilemma rather than a race, because opening a door lets the opponent
  through it too.
- The visible corner configuration that opened a face is itself information —
  the opponent can read which symbol was committed and where. This is intended,
  and is the mental layer that makes shared unlocking interesting rather than
  merely safe.
- **Unlock is permanent.** A destroyed corner does not re-lock a face.
  Re-locking would strand pieces on an unreachable face.
- `unlockedFaces` enters `GameState` here, once rather than per board, because
  it is shared. It starts as `[home]`, which is also correct for `main`, where
  every location is already on face 0.
- Placement on a locked face is rejected with a new `RejectionReason`. It is
  unreachable for `main`.
- The Phase 1 debug toggle is removed; the padlock now reports real state.
- **Known interaction, not a bug:** filling a full edge row also completes a
  power-up line, so one move can unlock a face and a power-up together.
- Arrows toward locked neighbours stay visible at reduced alpha rather than
  disappearing — a missing arrow reads as "no face there", which is wrong on a
  cube where every face has four neighbours.

### Phase 3 — The fork

Decided by playing phases 1 and 2, not in advance. Either a race / cooldown
model or a refined turn-based one. Specified separately when there is evidence.

## The deferred fork: cooldown

Real-time cooldown play is deliberately out of scope, and it is worth recording
why, because it was the original framing of the idea.

Cooldown deletes `activeSeat` as a concept. In the engine that removes
`consumeTurn`, `otherSeat`, `maxTurns`, `currentRound`, `resolveAutomaticPasses`,
`applyTimeout`, and the entire `extraTurn` power-up, whose
`pendingExtraPlacements` only means anything inside a turn. `DESECRATION_TURNS`
decays on its owner's turn and would have to become a duration in seconds. In
the coordinator it removes the one-deadline-per-room model,
`resetPlacementWindow`, and `resolveExpiredDeadline`. It also touches the
offline bot, the turn-timer UI, and `turnCount` in match history.

That is a second engine, and it collides with roadmap item "Next up 1:
Simultaneous conflict resolution", whose principled fix is described there as
restructuring turn flow.

The reason to defer is not cost. It is that changing what a *board* is and what
a *turn* is simultaneously makes the result unfalsifiable: when it is not fun,
there is no way to tell which change is responsible.

One prior observation worth keeping: `bufferedOpponentUpdate` in the coordinator
already exists to withhold placements from the opponent until an extra turn
commits. If delayed or partial reveal is ever wanted, that delivery mechanism
exists.

## Testing

Per `CLAUDE.md`, tests come before runtime changes.

- Golden test: `main` topology byte-identical to today's `locationIds` and
  `winningPatterns`.
- Adjacency invariants: four neighbours per face, symmetric, no self-adjacency,
  opposite pairs never adjacent.
- `locationId` round-trip: `faceOf` / `cellOf` over all 54.
- Config clamp: unknown variant falls back to `main`; a config with no variant
  field falls back to `main`; `prototype` forces `boardSize` 3.
- Matchmaking: a `main` seeker and a `prototype` seeker never pair.
- History: a finished `prototype` run does not call `onMatchCompleted`.
- Phase 1 navigation: arrow keys, WASD, and arrow taps produce the same face
  change; moving off a face and back lands on the same face; every face is
  reachable from `home` in at most two steps.
- Phase 1 debug toggle: changes presentation only — `GameState` is byte-identical
  before and after, and no packet is sent.
- Phase 2: locked-face placement rejected; shared unlock visible to both seats;
  a destroyed corner does not re-lock.

## Open items

Recorded rather than resolved. None of them block Phase 0.

- Whether `rounds: 12` is the right length, or whether `turnSeconds` should drop
  for the variant instead. 12 is a starting guess, not a considered number.
- Whether the map should show any indication of opponent activity on other
  faces. Currently it shows none, which is consistent with blind mode but makes
  a far face feel inert.
- Whether expansion should have a tempo cost. In Phase 1 navigation is free, so
  expansion is free. That is fine for "does it feel like anything" and is
  certainly wrong for balance.
- Whether scoring should be per-face majority rather than a raw cell count. Only
  relevant once there is a win condition.
