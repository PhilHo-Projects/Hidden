# Cube Prototype Phase 2 (engine half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the engine the face-unlock rule — a matching corner pair on an edge opens the face across it, shared between both players and permanent — and track it in `GameState`, **without gating a single placement**.

**Architecture:** `GameState` gains one field, `unlockedFaces`, starting `['home']`. A new `maybeUnlockFace` runs immediately after `maybeUnlockPowerup` inside `place`, so it sees the board *after* conflict resolution and therefore only counts corners the placing player actually still holds. The rule is inert for `main`, which returns before reading any cube geometry. Nothing rejects, nothing is announced, and nothing outside `packages/game-core/` changes.

**Tech Stack:** TypeScript 5.9, `node:test`, Node 24.

**Spec:** [`docs/superpowers/specs/2026-09-11-cube-prototype-mode-design.md`](../specs/2026-09-11-cube-prototype-mode-design.md) — the "Phase 2 — The expansion mechanic" section.

**Companion:** Phase 1 shipped on 2026-09-12 ([plan](2026-09-12-cube-prototype-phase-1.md)). Read its "Notes for whoever executes this" before starting.

---

## Read this before anything else

This branch is deliberately **half** of the spec's Phase 2, and it is the half that
changes nothing a player can see.

| In scope here | Explicitly NOT here |
|---|---|
| `unlockedFaces` on `GameState`, starting `['home']` | Rejecting a placement on a locked face |
| The corner-pair trigger, shared and permanent | A new `RejectionReason` |
| Corner and edge geometry in `topology.ts` | Any change under `web/` or `server/` |
| Tests for all of it, including `main` inertness | A `face-unlocked` domain event |
| | Deleting the Phase 1 padlock |

**Why split it this way.** A second session is iterating on the cube's GUI in
`web/src/prototype-mode.css`, `FaceArrows.tsx`, `CubeMap.tsx`, `CubeNet.tsx`, and
`App.tsx` at the same time as this branch. Keeping every edit inside
`packages/game-core/` means the two never touch the same file. The gating switch
and the UI wiring land afterwards, in that other session, once the visual design
has settled — Phase 1 deliberately shipped the locked *treatment* already, so
there is nothing to build there but a rename and a deletion.

**A half-rule is safe to ship; a half-gate is not.** If the engine started
rejecting placements on locked faces while the client still drew every face as
open, a player would be silently blocked from five sixths of the board with no
explanation. So this branch tracks and never enforces. `unlockedFaces` grows
exactly as it will when gating is switched on, which is what makes the switch a
one-line change later.

## Global Constraints

- Node 24.
- **Every edit in this branch is under `packages/game-core/`**, plus the two
  docs files in the final task. If you find yourself opening anything in `web/`
  or `server/`, stop — you have left the scope and will collide with the other
  session.
- **No new `DomainEvent` variant.** `presentEvent` in
  `web/src/game/coreAdapter.ts` switches exhaustively on `DomainEvent['type']`
  with no `default`, so adding a variant makes the web build fail to compile.
  That is a `web/` change, which this branch may not make. An announcement for
  an opened face belongs with the UI wiring.
- **`ENGINE_REVISION` stays at 2.** Tracking a new field changes no placement
  resolution, no scoring, and draws no RNG. For `main` the trigger returns
  before it reads anything. The existing golden test in `topology.test.ts` still
  has to pass untouched.
- **Never mutate `unlockedFaces` in place.** It is replaced wholesale, which is
  what lets `cloneState` share the reference.
- Tests come before runtime changes (`CLAUDE.md`, "Change discipline").
- Verification: `npm test` and `npm run build` in `packages/game-core/`, then
  `npm test` at the repository root to prove `web/` and `server/` still pass
  untouched.
- Do not deploy. Do not merge to `main` without saying so — the other session
  may want to land first.

## Before you start

The branch already exists and is based on `main` at `d0db653`:

```bash
git switch cube-prototype-phase-2-engine
```

If the other session has landed on `main` since, rebase before starting — their
changes are all in `web/`, so it will be clean:

```bash
git fetch origin && git rebase origin/main
```

## File Structure

**Modified:**
- `packages/game-core/src/topology.ts` — corner and edge geometry. Pure data next to the adjacency table it belongs with.
- `packages/game-core/src/topology.test.ts` — geometry invariants.
- `packages/game-core/src/index.ts` — `GameState.unlockedFaces`, `createGame`, `cloneState`, `maybeUnlockFace`, one call in `place`.
- `packages/game-core/src/index.test.ts` — the trigger's behaviour and `main`'s inertness.
- `docs/ROADMAP.md`, `docs/JOURNAL.md` — final task only.

---

### Task 1: Corner and edge geometry

Pure data and one lookup. It lives in `topology.ts` because that is already the
only module in the package that knows a board has a shape, and it sits directly
under `CUBE_ADJACENCY`, whose `FaceDirection` keys it reuses.

**Files:**
- Modify: `packages/game-core/src/topology.ts`
- Test: `packages/game-core/src/topology.test.ts`

**Interfaces:**
- Consumes: `FaceDirection`, `deepFreeze` (already in the module).
- Produces, exported from `topology.ts` and re-exported by `index.ts`:
  - `const FACE_CORNER_CELLS: readonly number[]` — `[0, 2, 6, 8]`
  - `const EDGE_CORNER_CELLS: Readonly<Record<FaceDirection, readonly [number, number]>>`
  - `const FACE_DIRECTIONS: readonly FaceDirection[]` — `['north','east','south','west']`

- [ ] **Step 1: Write the failing geometry tests**

Append to `packages/game-core/src/topology.test.ts`:

```ts
describe('face corners and edges', () => {
  it('names the four corners of a 3x3 face', () => {
    assert.deepEqual([...FACE_CORNER_CELLS], [0, 2, 6, 8])
  })

  it('defines each edge by the two corners that sit on it', () => {
    assert.deepEqual(EDGE_CORNER_CELLS.north, [0, 2])
    assert.deepEqual(EDGE_CORNER_CELLS.east, [2, 8])
    assert.deepEqual(EDGE_CORNER_CELLS.south, [6, 8])
    assert.deepEqual(EDGE_CORNER_CELLS.west, [0, 6])
  })

  it('uses only corner cells, and every corner on exactly two edges', () => {
    // The overlap is the interesting part of the rule rather than an accident:
    // one placement on a corner can complete two edges at once, and therefore
    // open two faces on the same turn.
    const appearances = new Map<number, number>()
    for (const direction of FACE_DIRECTIONS) {
      for (const cell of EDGE_CORNER_CELLS[direction]) {
        assert.ok(FACE_CORNER_CELLS.includes(cell), `${cell} is a corner`)
        appearances.set(cell, (appearances.get(cell) ?? 0) + 1)
      }
    }

    for (const corner of FACE_CORNER_CELLS) {
      assert.equal(appearances.get(corner), 2, `corner ${corner} sits on two edges`)
    }
  })

  it('gives each direction a distinct pair', () => {
    const pairs = FACE_DIRECTIONS.map((d) => EDGE_CORNER_CELLS[d].join('-'))

    assert.equal(new Set(pairs).size, 4)
  })

  it('is frozen', () => {
    assert.ok(Object.isFrozen(EDGE_CORNER_CELLS))
    assert.ok(Object.isFrozen(FACE_CORNER_CELLS))
  })
})
```

Add `FACE_CORNER_CELLS`, `EDGE_CORNER_CELLS`, and `FACE_DIRECTIONS` to the
import list at the top of the file. The existing local `DIRECTIONS` constant in
that file becomes redundant — replace its declaration with the imported
`FACE_DIRECTIONS` and update its uses, so the test file and the module cannot
disagree about the direction order.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@hidden/game-core`
Expected: FAIL — typecheck reports `topology.ts` has no exported member `FACE_CORNER_CELLS`.

- [ ] **Step 3: Implement**

Append to `packages/game-core/src/topology.ts`, directly after `CUBE_ADJACENCY`:

```ts
/** The order every per-face loop walks. Exported so callers and tests cannot
 * disagree about it. */
export const FACE_DIRECTIONS: readonly FaceDirection[] = deepFreeze([
  'north',
  'east',
  'south',
  'west',
] as FaceDirection[])

/** Cell indices of a 3x3 face's corners. */
export const FACE_CORNER_CELLS: readonly number[] = deepFreeze([0, 2, 6, 8] as number[])

/**
 * The two corners that sit on each edge of a face.
 *
 * Holding both with the same symbol is what opens the face across that edge.
 * Every corner appears on exactly two edges, so a single placement on a corner
 * can complete two edges at once and open two faces on the same turn. That is
 * intended, not an accident of the numbering.
 */
export const EDGE_CORNER_CELLS: Readonly<
  Record<FaceDirection, readonly [number, number]>
> = deepFreeze({
  north: [0, 2],
  east: [2, 8],
  south: [6, 8],
  west: [0, 6],
}) as Readonly<Record<FaceDirection, readonly [number, number]>>
```

- [ ] **Step 4: Publish the names**

In `packages/game-core/src/index.ts`, add `EDGE_CORNER_CELLS`, `FACE_CORNER_CELLS`, and `FACE_DIRECTIONS` to the `export { … } from './topology.ts'` block, keeping it alphabetical.

Then add the same three strings to the sorted array in `index.test.ts`'s
`public surface` test. That test will fail first and tell you exactly what it
expected — that is its job.

- [ ] **Step 5: Run the suite**

Run: `npm test --workspace=@hidden/game-core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/game-core
git commit -m "feat(game-core): add face corner and edge geometry

Pure data next to the adjacency table it belongs with. Every corner sits
on exactly two edges, so one placement can open two faces; that overlap
is the rule, not an accident of the numbering.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `unlockedFaces` on `GameState`

The field, created and cloned. Inert — nothing writes to it after `createGame`
and nothing reads it. Landing it separately keeps Task 3's diff to the rule
itself.

**Files:**
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: `CubeFace` from `./topology.ts`.
- Produces: `GameState.unlockedFaces: readonly CubeFace[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/game-core/src/index.test.ts`:

```ts
describe('unlocked faces', () => {
  it('starts a prototype match on home alone', () => {
    const state = createGame(baseSpec({ config: defaultConfigForVariant('prototype') }))

    assert.deepEqual([...state.unlockedFaces], ['home'])
  })

  it('starts a main match on home too', () => {
    // Correct rather than merely harmless: `main` has one face and every
    // location is already on it. The field is never read for `main`.
    const state = createGame(baseSpec())

    assert.deepEqual([...state.unlockedFaces], ['home'])
  })

  it('survives a command unchanged', () => {
    const state = createGame(baseSpec({ config: defaultConfigForVariant('prototype') }))
    const result = applyCommand(state, state.activeSeat, {
      type: 'place',
      locationId: 4,
      symbol: 'rock',
    })

    assert.equal(result.accepted, true)
    assert.deepEqual([...result.state.unlockedFaces], ['home'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@hidden/game-core`
Expected: FAIL — `Property 'unlockedFaces' does not exist on type 'GameState'`.

- [ ] **Step 3: Implement**

Add `CubeFace` to the type import from `./topology.ts` at the top of `index.ts`.

In the `GameState` interface, after `pendingExtraPlacements`:

```ts
  /**
   * Faces both players may reach. One list, not one per seat, because either
   * player's corner pair opens a face for both — which is what stops a player
   * farming territory the opponent cannot reach, and is why the map needs no
   * hidden state.
   *
   * Only ever replaced, never mutated in place; `cloneState` shares the
   * reference on that basis. Unlocking is permanent, so this only grows.
   */
  readonly unlockedFaces: readonly CubeFace[]
```

In `createGame`'s returned object, after `pendingExtraPlacements: []`:

```ts
    unlockedFaces: ['home'],
```

`cloneState` needs **no change**: the `...state` spread carries the reference,
and that is correct precisely because the field is never mutated in place. Add a
line to the comment block above `config` in `cloneState` recording that
`unlockedFaces` is shared for the same reason.

- [ ] **Step 4: Run the suite**

Run: `npm test --workspace=@hidden/game-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-core
git commit -m "feat(game-core): track unlocked faces on GameState

One list rather than one per seat, because either player's corner pair
opens a face for both. Inert for now: created, cloned, and read by
nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The corner-pair trigger

The rule itself. Shared, permanent, prototype-only, and enforcing nothing.

**Files:**
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2, plus `CUBE_FACES`, `firstLocationOfFace`, `neighbourFace` (already exported).
- Produces: no new exports. `maybeUnlockFace` is internal, like `maybeUnlockPowerup`.

- [ ] **Step 1: Write the failing tests**

These need a helper that drives a specific sequence of placements. Append to
`packages/game-core/src/index.test.ts`:

```ts
describe('the face unlock trigger', () => {
  const cubeSpec = () => baseSpec({ config: defaultConfigForVariant('prototype') })

  /**
   * Places a list of `[seat, locationId, symbol]` in order, forcing the active
   * seat each time so a test can describe the board it wants rather than the
   * turn order that would have produced it.
   */
  const drive = (
    state: GameState,
    moves: readonly (readonly [Seat, number, 'rock' | 'paper' | 'scissors'])[],
  ) => {
    let working = state
    for (const [seat, locationId, symbol] of moves) {
      const forced = { ...working, activeSeat: seat } as GameState
      const result = applyCommand(forced, seat, { type: 'place', locationId, symbol })
      assert.equal(result.accepted, true, `placing ${symbol} on ${locationId}`)
      working = result.state
    }
    return working
  }

  it('opens the face across an edge when one player holds both its corners', () => {
    // home's north edge is cells 0 and 2, and north of home is `up`.
    const state = drive(createGame(cubeSpec()), [
      [0, 0, 'rock'],
      [0, 2, 'rock'],
    ])

    assert.deepEqual([...state.unlockedFaces].sort(), ['home', 'up'])
  })

  it('needs the two corners to carry the same symbol', () => {
    const state = drive(createGame(cubeSpec()), [
      [0, 0, 'rock'],
      [0, 2, 'paper'],
    ])

    assert.deepEqual([...state.unlockedFaces], ['home'])
  })

  it('opens the face for both players, whichever one earned it', () => {
    // The central rule decision. Seat 1's pair opens `up` for seat 0 as well,
    // because `unlockedFaces` is one list rather than one per board.
    const state = drive(createGame(cubeSpec()), [
      [1, 0, 'scissors'],
      [1, 2, 'scissors'],
    ])

    assert.deepEqual([...state.unlockedFaces].sort(), ['home', 'up'])
  })

  it('opens two faces when one placement completes two edges', () => {
    // Cell 2 is the shared corner of home's north {0,2} and east {2,8} edges,
    // so placing it last opens `up` and `right` on the same turn.
    const state = drive(createGame(cubeSpec()), [
      [0, 0, 'rock'],
      [0, 8, 'rock'],
      [0, 2, 'rock'],
    ])

    assert.deepEqual([...state.unlockedFaces].sort(), ['home', 'right', 'up'])
  })

  it('keeps a face open after the corner that opened it is destroyed', () => {
    // Permanent on purpose: re-locking would strand pieces on a face nobody
    // could reach again.
    const opened = drive(createGame(cubeSpec()), [
      [0, 0, 'rock'],
      [0, 2, 'rock'],
    ])
    assert.deepEqual([...opened.unlockedFaces].sort(), ['home', 'up'])

    // Paper beats rock, so seat 1 playing paper on the same cell destroys it.
    const after = drive(opened, [[1, 0, 'paper']])

    assert.equal(after.boards[0].locations[0].symbol, null)
    assert.deepEqual([...after.unlockedFaces].sort(), ['home', 'up'])
  })

  it('does not open a face from corners held on a face that is still locked', () => {
    // `back` starts locked, so a pair sitting on it counts for nothing. Phase 2
    // will make those placements impossible; until then the tracked state has
    // to match what gating would have produced.
    const state = drive(createGame(cubeSpec()), [
      [0, 45, 'rock'],
      [0, 47, 'rock'],
    ])

    assert.deepEqual([...state.unlockedFaces], ['home'])
  })

  it('never unlocks anything in a main match', () => {
    // `main` returns before any cube geometry is read. Its board size is not 9,
    // so `faceOf` would be meaningless there.
    const state = drive(createGame(baseSpec()), [
      [0, 0, 'rock'],
      [0, 2, 'rock'],
    ])

    assert.deepEqual([...state.unlockedFaces], ['home'])
  })

  it('rejects nothing on a locked face in this phase', () => {
    // The half-rule this branch ships: tracked, never enforced. When gating is
    // switched on, this test flips to asserting a rejection.
    const state = createGame(cubeSpec())
    const result = applyCommand(state, state.activeSeat, {
      type: 'place',
      locationId: 53,
      symbol: 'rock',
    })

    assert.equal(result.accepted, true)
    assert.equal(result.state.boards[state.activeSeat].locations[53].symbol, 'rock')
  })
})
```

`GameState` and `Seat` are already imported as types in that file; add them if
the import list does not have them.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@hidden/game-core`
Expected: FAIL on the unlock assertions — `unlockedFaces` stays `['home']`
everywhere, because nothing writes to it yet. The last two tests
(`main`, `rejects nothing`) should already PASS; that is expected and correct.

- [ ] **Step 3: Implement `maybeUnlockFace`**

Add to the topology import in `index.ts`: `EDGE_CORNER_CELLS`,
`FACE_DIRECTIONS`, `firstLocationOfFace`, `neighbourFace`, and the type
`CubeFace` if Task 2 did not already bring it in.

Place this directly after `maybeUnlockPowerup`, which it deliberately mirrors:

```ts
/**
 * Opens the faces across any edge whose two corners the acting seat now holds
 * with one symbol.
 *
 * Called after `resolveConflict`, so it reads the board as it settled: a corner
 * that was just destroyed by the opponent's better symbol does not count, which
 * is the behaviour you want and the reason this cannot run earlier.
 *
 * Shared and permanent. Either seat's pair opens a face for both, and nothing
 * ever removes one — re-locking would strand pieces on an unreachable face.
 *
 * Only searches faces that are already open. A pair on a locked face counts for
 * nothing, which keeps the tracked state identical to what it will be once
 * placement is actually gated.
 */
function maybeUnlockFace(state: GameState, seat: Seat) {
  // `main` has one face, and its board is not nine cells, so none of the cube
  // geometry below would mean anything there.
  if (state.config.variant !== 'prototype') return

  const board = state.boards[seat]
  const opened: CubeFace[] = []
  // Snapshot: `opened` is collected separately so the loop is not walking an
  // array it is also appending to.
  const searchable = [...state.unlockedFaces]

  for (const face of searchable) {
    const offset = firstLocationOfFace(face)
    for (const direction of FACE_DIRECTIONS) {
      const neighbour = neighbourFace(face, direction)
      if (state.unlockedFaces.includes(neighbour) || opened.includes(neighbour)) continue

      const [firstCell, secondCell] = EDGE_CORNER_CELLS[direction]
      const first = board.locations[locationIndex(state, seat, offset + firstCell)]
      const second = board.locations[locationIndex(state, seat, offset + secondCell)]
      if (!first?.symbol || first.symbol !== second?.symbol) continue

      opened.push(neighbour)
    }
  }

  if (opened.length === 0) return
  ;(state as Mutable<GameState>).unlockedFaces = [...state.unlockedFaces, ...opened]
}
```

- [ ] **Step 4: Call it from `place`**

One line, immediately after `maybeUnlockPowerup`:

```ts
  resolveConflict(next, command.locationId, events)
  maybeUnlockPowerup(next, seat, events)
  // Same position and the same reason: the board has settled, so both rules
  // read what the player actually still holds.
  maybeUnlockFace(next, seat)
```

This covers the bot too — `applyTimeout` places through `place`.

- [ ] **Step 5: Run the suite**

Run: `npm test --workspace=@hidden/game-core`
Expected: PASS, all of it, including the untouched `main` golden test.

- [ ] **Step 6: Prove the rest of the repository is unaffected**

```bash
npm run build --workspace=@hidden/game-core
npm test
```

Expected: the root suite passes — game-core, web, and server — with no changes
outside `packages/game-core/`. Confirm with `git status` that nothing under
`web/` or `server/` is modified.

- [ ] **Step 7: Commit**

```bash
git add packages/game-core
git commit -m "feat(game-core): open a face when a matching corner pair lands

Runs after conflict resolution, so a corner the opponent just destroyed
does not count. Shared between both seats and permanent, and it searches
only faces that are already open, so the tracked state matches what
gating will produce.

Nothing is rejected yet. This is deliberately the half of Phase 2 that
changes nothing on screen; the gate and the UI land together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Record what is true and what is still owed

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/JOURNAL.md`

- [ ] **Step 1: Run every check and record the real output**

```bash
npm test
npm run build --workspace=@hidden/game-core
npm run build --workspace=hidden-server
```

`npm run build --workspace=hidden-web` needs `VITE_TURNSTILE_SITE_KEY` set or it
fails before compiling — that is a pre-existing gate, not something this branch
introduced. Cloudflare's public always-pass test key
`1x00000000000000000000AA` is fine for a local build check.

- [ ] **Step 2: Update the roadmap**

In the phase table, change Phase 2's Status cell to `Engine rule done 2026-09-12; not gated`, and change its Scope cell to make the split explicit:

```
| 2 | The expansion mechanic: matching corner pair on an edge unlocks the face across it, shared and permanent. The rule and `unlockedFaces` are in the engine; placement gating and the UI wiring are still owed. | Engine rule done 2026-09-12; not gated |
```

Then add this under the "Active work — cube prototype mode" prose:

```
The unlock rule exists in the engine and is not switched on. `GameState`
carries `unlockedFaces`, starting `['home']`, and a matching corner pair on an
edge adds the face across it — shared between both players and permanent. No
placement is rejected, so the mode still plays exactly as Phase 1 shipped it.

What is still owed, and it is small: gate `place` on `unlockedFaces` with a new
`RejectionReason`, point the padlock and the dimmed arrows at real state instead
of the client-side toggle, and delete the toggle. The locked *treatment* already
exists, which is why Phase 1 built it a phase early.
```

- [ ] **Step 3: Journal it**

Add an entry dated 2026-09-12 (below the Phase 1 entry) covering what landed and
the two facts worth keeping:

- The trigger runs after `resolveConflict` for the same reason
  `maybeUnlockPowerup` does — a corner destroyed by the opponent's better symbol
  must not count.
- It searches only faces that are already open, so the tracked state is
  identical to what it will be once placement is gated. That is what makes
  switching the gate on a one-line change rather than a re-derivation.
- Why no `face-unlocked` event: `presentEvent` in `web/src/game/coreAdapter.ts`
  switches exhaustively on `DomainEvent['type']` with no `default`, so a new
  variant breaks the web build — and this branch was scoped to `game-core` to
  stay clear of a parallel GUI session.

- [ ] **Step 4: Commit and open the pull request**

```bash
git add docs
git commit -m "docs: record the cube unlock rule as landed but not gated

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin cube-prototype-phase-2-engine
```

Open the PR with `gh pr create`. Say plainly in the body that **no placement is
gated and nothing on screen changes**, so a reviewer does not go looking for the
behaviour. End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

**Do not deploy.** Merging does not release; production delivery is an explicit
manual release, and there is nothing here a player could see anyway.

## Notes for whoever executes this

**`packages/game-core` runs `node:test`, not Vitest.** Its tests use
`assert.equal` / `assert.deepEqual` and import with the `.ts` extension —
extensionless relative imports do not resolve there.

**The public surface test will fail the moment you export something.** That is
deliberate. Add the name to the sorted list in `index.test.ts` and move on.

**`locationIndex(state, seat, locationId)` is the accessor to use**, not raw
array indexing. For the cube they happen to be equal, and relying on that would
be the kind of assumption this codebase keeps deleting.

**Do not bump `ENGINE_REVISION`.** Nothing here changes placement resolution,
scoring, or the RNG stream, and `main` returns before reading any of it.

**A corner sits on two edges.** Cell 2 is on both north `{0,2}` and east
`{2,8}`, so one placement can open two faces. The loop already handles it and a
test pins it; do not "fix" it into one face per turn.
