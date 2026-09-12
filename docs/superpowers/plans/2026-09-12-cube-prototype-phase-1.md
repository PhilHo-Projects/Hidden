# Cube Prototype Mode — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the prototype variant's single 3x3 board into a 54-location cube with all six faces open from turn 1, navigable one face at a time by brace arrows, arrow keys, WASD, and an unfolded cross map, with a padlock that switches navigation off so the locked treatment can be looked at.

**Architecture:** `packages/game-core/src/index.ts` splits into `config.ts`, `topology.ts`, and the reducer, as its own commit. `topology.ts` then gains the cube: six faces, `locationId = faceIndex * 9 + cellIndex`, a 24-entry adjacency table, and `topologyForConfig(config)` which `buildMode` calls instead of `createTopology(boardSize, streak)`. Nothing else in the engine changes — `GameState`, the packets, and `RejectionReason` are untouched, and a `main` match resolves byte-identically. Every cube-specific thing the player can do is a **camera**: which face you are looking at and whether navigation is switched on are client-only state, held in one hook, never serialised, never sent.

**Tech Stack:** TypeScript 5.9, React 19, Vite 8, Vitest (web), `node:test` (game-core), Node 24.

**Spec:** [`docs/superpowers/specs/2026-09-11-cube-prototype-mode-design.md`](../specs/2026-09-11-cube-prototype-mode-design.md)

## Global Constraints

- Node 24.
- **`ENGINE_REVISION` stays at 2.** Nothing here changes placement resolution, scoring, or the RNG for a `main` match. Task 2's golden test is the proof. If it fails, stop and re-read the spec's "Engine revision: no bump" section — the answer is to fix the topology builder, not to bump the revision.
- **Preserve numeric packet IDs.** This phase adds no packets, changes no packet numbers, and adds no fields to `GameState`. `GAME_COMMAND` already validates `locationId` as any non-negative safe integer, so IDs 0–53 travel today.
- **Nothing cube enters `GameState` or the wire.** Active face and navigation lock are per-player view state. Putting either in `GameState` would serialise it to the opponent and leak position information in a mode whose premise is hidden boards.
- **No placement gating.** Every one of the 54 locations is legal in Phase 1. No new `RejectionReason`, no `unlockedFaces`. That is Phase 2.
- Tests come before runtime changes (`CLAUDE.md`, "Change discipline").
- `main` and `prototype` are placeholder names. Do not invent nicer ones. Face IDs `home`/`up`/`down`/`left`/`right`/`back` are cube-intrinsic and are not placeholders — keep them.
- **Load the `frontend-design` skill before Task 5 and Task 6.** The arrows and the map are the only genuinely new visual surface in this mode.
- Verification per package: `npm test`, `npm run lint`, `npm run build` in `web/`; `npm test` and `npm run build` in `server/`; `npm test` in `packages/game-core/`.
- Do not add automated deployment workflows. Do not deploy as part of this plan.

## Spec deltas agreed for this phase

Two points differ from the spec as written on 2026-09-11. Both are deliberate and were decided after it was written. Do not "correct" them back.

1. **The padlock really does switch navigation off.** The spec says the Phase 1 padlock "flips the *presentation* so the dimmed-arrow treatment can be looked at". It now also disables the arrow buttons, the map's face tiles, and the keyboard directions. This stays inside every constraint the spec cared about: navigation is camera state, so a disabled arrow touches no `GameState`, sends no packet, and rejects no placement. It is strictly more useful, because locked navigation is what Phase 2 will actually feel like.

   Consequence, and it is the right one: while locked you can only place on the face you are standing on. That is the preview.

2. **The reveal power-up shows one face, not the whole cube.** 54 cells in a timed snapshot is not memorisable, and `RevealSnapshot`'s card is sized for one board. The reveal shows the opponent's board on **the face the revealing player is currently looking at**. This weakens the power-up in the prototype. Phase 1 is not balance work; Task 10 records it in the roadmap's open items.

## Before you start

Other sessions land PRs on `main` mid-task, so rebase before starting and branch:

```bash
git fetch origin && git switch main && git pull --ff-only && git switch -c cube-prototype-phase-1
```

## File Structure

**Created:**
- `packages/game-core/src/config.ts` — primitives, engine identity, `GameConfig`, defaults, clamps, `deepFreeze`. Depends on nothing.
- `packages/game-core/src/topology.ts` — `ClassicTopology`, the square grid builder, the cube faces and adjacency, `topologyForConfig`. Imports from `./config.ts`.
- `packages/game-core/src/topology.test.ts` — cube geometry and the `main` golden test.
- `web/src/game/faceNavigation.ts` — the camera as a pure module: which face, locked or not, key-to-direction, the cross layout, grid slicing. Pure so the navigation rules are testable without a DOM.
- `web/src/game/__tests__/faceNavigation.test.ts`
- `web/src/components/FaceArrows.tsx` — the four brace arrows.
- `web/src/components/CubeMap.tsx` — the unfolded cross plus the padlock.
- `web/src/components/CubeNet.tsx` — all six faces in the cross, for the result screen.
- `web/src/components/__tests__/FaceArrows.test.ts`
- `web/src/components/__tests__/CubeMap.test.ts`
- `web/src/components/__tests__/CubeNet.test.ts`
- `web/src/hooks/useFaceCamera.ts` — owns the camera state and the window keydown listener.
- `web/src/hooks/__tests__/useFaceCamera.test.ts`
- `web/src/hooks/__tests__/useBoardSideVar.test.ts`

**Modified:**
- `packages/game-core/src/index.ts` — reducer only; re-exports the public API explicitly.
- `packages/game-core/src/index.test.ts` — public-surface test, 54-location `createGame` test.
- `packages/game-core/tsconfig.json` — `.ts`-extension imports.
- `packages/game-core/package.json` — the test script names both test files.
- `web/src/components/BoardGrid.tsx` — explicit `columns`, `indexOffset`, `navigation` slot; `boardColumns()` deleted.
- `web/src/components/__tests__/BoardGrid.test.ts`
- `web/src/components/RevealSnapshot.tsx` — passes layout through.
- `web/src/components/__tests__/RevealSnapshot.test.ts`
- `web/src/hooks/useBoardSideVar.ts` — the measuring selector, which the arrow frame otherwise breaks.
- `web/src/App.tsx` — battle board becomes a face, map in the controls column, net on the result screen.
- `web/src/prototype-mode.css` — arrows, map, padlock, net.
- `docs/ROADMAP.md`, `docs/JOURNAL.md`.

---

### Task 1: Split `game-core` into three modules

No behaviour change, no new exports, its own commit. The file is 922 lines and the cube would push it past 1100; doing the split separately is what keeps Task 2's diff reviewable.

Dependency order is `config.ts` → `topology.ts` → `index.ts`, acyclic. `deepFreeze` moves to `config.ts` because it is the lowest module; it stays internal and is **not** re-exported.

One deliberate deviation from the spec: `BoardSize` lives in `config.ts`, not `topology.ts`. `clampGameConfig` owns the board-size clamp, and putting the type next to its clamp is what keeps the dependency edge pointing config → topology instead of both ways.

**Files:**
- Create: `packages/game-core/src/config.ts`
- Create: `packages/game-core/src/topology.ts`
- Modify: `packages/game-core/src/index.ts`
- Modify: `packages/game-core/tsconfig.json`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.ts` exports `Seat`, `LocationId`, `ClassicSymbol`, `PowerupKey`, `ENGINE_ID`, `ENGINE_REVISION`, `EngineRef`, `BoardSize`, `GameVariant`, `PROTOTYPE_BOARD_SIZE`, `PROTOTYPE_ROUNDS`, `GameConfig`, `DEFAULT_GAME_CONFIG`, `MIN_TURN_SECONDS`, `ONLINE_MIN_TURN_SECONDS`, `MAX_TURN_SECONDS`, `MIN_REVEAL_SECONDS`, `MAX_REVEAL_SECONDS`, `clampGameConfig`, `clampOnlineGameConfig`, `decodeGameConfig`, `defaultConfigForVariant`, `deepFreeze`. `topology.ts` exports `ClassicTopology` and `createTopology`. `index.ts`'s public surface is unchanged.

- [ ] **Step 1: Write the public-surface characterisation test**

This is the test that makes the split safe, and it stays useful afterwards: every later task that adds an export has to come back here and say so.

Add to the end of `packages/game-core/src/index.test.ts`:

```ts
describe('public surface', () => {
  it('exports exactly the documented runtime names', async () => {
    const surface = await import('./index.ts')

    // Sorted so the list reads as a set rather than as a file order. Adding a
    // name here is a deliberate act: everything in this list is something a
    // stored match, the server, or the client may already depend on.
    assert.deepEqual(Object.keys(surface).sort(), [
      'DEFAULT_GAME_CONFIG',
      'ENGINE_ID',
      'ENGINE_REVISION',
      'GAME_CORE_VERSION',
      'MAX_REVEAL_SECONDS',
      'MAX_TURN_SECONDS',
      'MIN_REVEAL_SECONDS',
      'MIN_TURN_SECONDS',
      'ONLINE_MIN_TURN_SECONDS',
      'PROTOTYPE_BOARD_SIZE',
      'PROTOTYPE_ROUNDS',
      'applyCommand',
      'applyTimeout',
      'clampGameConfig',
      'clampOnlineGameConfig',
      'createGame',
      'createTopology',
      'decodeGameConfig',
      'defaultConfigForVariant',
    ])
  })
})
```

- [ ] **Step 2: Run it and confirm it passes before the split**

Run: `npm test --workspace=@hidden/game-core`
Expected: PASS. This one is written green on purpose — it is a characterisation test, and its job is to fail *after* a careless split, not before one. If it fails now, the list above is wrong; fix the list, not the package.

- [ ] **Step 3: Commit the characterisation test**

```bash
git add packages/game-core/src/index.test.ts
git commit -m "test(game-core): pin the public export surface

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Allow `.ts`-extension imports between source files**

`node --test` runs the TypeScript directly and its CommonJS resolver will **not** resolve an extensionless relative import — `import { x } from './config'` fails with `ERR_MODULE_NOT_FOUND`. Source files must import each other as `'./config.ts'`, which needs both flags below. `rewriteRelativeImportExtensions` is what turns the emitted `require("./config.ts")` into `require("./config.js")`.

Replace `packages/game-core/tsconfig.json` with:

```json
{
  "compilerOptions": {
    // `node --test` runs these files as TypeScript, and its CommonJS resolver
    // does not try a `.ts` extension for an extensionless relative import. So
    // sources import each other as "./config.ts", and these two flags are what
    // make that legal while still emitting real CommonJS: the second rewrites
    // the specifier to "./config.js" on the way out.
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "declaration": true,
    "module": "CommonJS",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "target": "ES2022"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`tsconfig.test.json` already sets `allowImportingTsExtensions` alongside `noEmit`; leave it as it is. It now inherits `rewriteRelativeImportExtensions` too, which is a no-op under `noEmit`.

- [ ] **Step 5: Create `config.ts`**

Move, verbatim and without editing behaviour, from `index.ts`: `Seat`, `LocationId`, `ClassicSymbol`, `PowerupKey`, `finiteNumberOrDefault`, `ENGINE_ID`, `ENGINE_REVISION`, `BoardSize`, `GameVariant`, `GAME_VARIANTS`, `PROTOTYPE_BOARD_SIZE`, `PROTOTYPE_ROUNDS`, `EngineRef`, `GameConfig`, `DEFAULT_GAME_CONFIG`, `BOARD_SIZES`, `SYMBOLS`, `POWERUP_KEYS`, `MIN_TURN_SECONDS`, `ONLINE_MIN_TURN_SECONDS`, `MAX_TURN_SECONDS`, `MIN_REVEAL_SECONDS`, `MAX_REVEAL_SECONDS`, `clampInteger`, `clampSeconds`, `clampTurnSeconds`, `booleanOrDefault`, `clampGameConfig`, `defaultConfigForVariant`, `clampOnlineGameConfig`, `decodeGameConfig`, and `deepFreeze`.

Keep every existing comment with the code it explains. Head the new file with:

```ts
/**
 * The rules a match is played under, and the primitives every other module
 * needs to describe one.
 *
 * Lowest module in the package: it imports nothing. `topology.ts` reads
 * `BoardSize` and `GameConfig` from here, and the reducer in `index.ts` reads
 * both. Keeping the edge pointing one way is what stops a circular import
 * between a config that clamps a board size and a topology built from it.
 */
```

`deepFreeze` gains an `export` so the other two modules can use it. `index.ts` must not re-export it — it is a helper, not protocol.

- [ ] **Step 6: Create `topology.ts`**

Move `ClassicTopology` and `createTopology` verbatim, with their comments. Head the file with:

```ts
import { deepFreeze, type BoardSize, type LocationId } from './config.ts'

/**
 * What a board *is*: the set of playable location IDs, and the lines that
 * unlock a power-up when one is completed.
 *
 * The only module in the package that knows a board has a shape. Every reducer
 * function in `index.ts` operates on opaque IDs and on `winningPatterns`, which
 * is data — which is why a cube needs a builder here and nothing else.
 */
```

- [ ] **Step 7: Reduce `index.ts` to the reducer plus explicit re-exports**

Delete everything moved out. Add at the top:

```ts
import {
  DEFAULT_GAME_CONFIG,
  ENGINE_ID,
  ENGINE_REVISION,
  clampGameConfig,
  deepFreeze,
  type ClassicSymbol,
  type GameConfig,
  type LocationId,
  type PowerupKey,
  type Seat,
} from './config.ts'
import { createTopology, type ClassicTopology } from './topology.ts'
```

and add at the bottom:

```ts
/*
 * The package's public surface, listed rather than star-exported.
 *
 * `export *` would also publish internal helpers — `deepFreeze` is the one that
 * would slip out today — and a protocol package's surface is worth being a
 * thing somebody has to type. `index.test.ts` asserts this list.
 */
export {
  DEFAULT_GAME_CONFIG,
  ENGINE_ID,
  ENGINE_REVISION,
  MAX_REVEAL_SECONDS,
  MAX_TURN_SECONDS,
  MIN_REVEAL_SECONDS,
  MIN_TURN_SECONDS,
  ONLINE_MIN_TURN_SECONDS,
  PROTOTYPE_BOARD_SIZE,
  PROTOTYPE_ROUNDS,
  clampGameConfig,
  clampOnlineGameConfig,
  decodeGameConfig,
  defaultConfigForVariant,
} from './config.ts'
export type {
  BoardSize,
  ClassicSymbol,
  EngineRef,
  GameConfig,
  GameVariant,
  LocationId,
  PowerupKey,
  Seat,
} from './config.ts'
export { createTopology } from './topology.ts'
export type { ClassicTopology } from './topology.ts'
```

The import of the names `index.ts` itself uses is separate from the re-export block. A name that is both used and published appears twice; that is fine, and is what keeps the published list readable as a list.

- [ ] **Step 8: Run the whole suite**

Run: `npm test --workspace=@hidden/game-core`
Expected: PASS, including the public-surface test. `npm run typecheck` runs first inside that script and will catch a name that failed to move.

- [ ] **Step 9: Confirm the build still emits one working package**

```bash
npm run build --workspace=@hidden/game-core && node -e "const c=require('./packages/game-core/dist/index.js'); console.log(Object.keys(c).length, c.ENGINE_REVISION)"
```

Expected: `19 2`. If `require` throws `Cannot find module './config'`, Step 4 was skipped or an import is missing its `.ts`.

- [ ] **Step 10: Confirm both consumers still build**

```bash
npm run build --workspace=hidden-server && npm run build --workspace=hidden-web
```

Expected: both succeed.

- [ ] **Step 11: Commit**

```bash
git add packages/game-core
git commit -m "refactor(game-core): split config and topology out of the reducer

No behaviour change. The cube topology lands next and would push a
922-line file past 1100; splitting first is what keeps that diff
reviewable. The public export surface is unchanged and pinned by test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The cube topology

Six faces, 54 locations, 48 winning patterns, and a golden test proving `main` did not move.

**Files:**
- Modify: `packages/game-core/src/topology.ts`
- Modify: `packages/game-core/src/index.ts` (`buildMode`, re-exports)
- Modify: `packages/game-core/package.json`
- Test: `packages/game-core/src/topology.test.ts` (create)
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 1's `config.ts` and `topology.ts`.
- Produces, from `topology.ts` and re-exported by `index.ts`:
  - `type CubeFace = 'home' | 'up' | 'down' | 'left' | 'right' | 'back'`
  - `type FaceDirection = 'north' | 'east' | 'south' | 'west'`
  - `interface FaceNeighbours { readonly north: CubeFace; readonly east: CubeFace; readonly south: CubeFace; readonly west: CubeFace }`
  - `const CUBE_FACES: readonly CubeFace[]` — index order, `home` first
  - `const CUBE_FACE_CELLS = 9`, `const CUBE_LOCATION_COUNT = 54`
  - `const CUBE_ADJACENCY: Readonly<Record<CubeFace, FaceNeighbours>>`
  - `function neighbourFace(face: CubeFace, direction: FaceDirection): CubeFace`
  - `function faceIndex(face: CubeFace): number`
  - `function faceOf(locationId: LocationId): CubeFace`
  - `function cellOf(locationId: LocationId): number`
  - `function firstLocationOfFace(face: CubeFace): LocationId`
  - `function createCubeTopology(streak: number): ClassicTopology`
  - `function topologyForConfig(config: GameConfig): ClassicTopology`

- [ ] **Step 1: Name both test files in the package script**

`node --test` is given explicit paths rather than a glob, because glob expansion differs between the Git Bash and PowerShell available on this machine.

In `packages/game-core/package.json`:

```json
"test": "npm run typecheck && node --no-warnings --test src/index.test.ts src/topology.test.ts"
```

- [ ] **Step 2: Write the failing geometry tests**

Create `packages/game-core/src/topology.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_GAME_CONFIG, defaultConfigForVariant } from './config.ts'
import {
  CUBE_ADJACENCY,
  CUBE_FACES,
  CUBE_FACE_CELLS,
  CUBE_LOCATION_COUNT,
  cellOf,
  createCubeTopology,
  createTopology,
  faceIndex,
  faceOf,
  firstLocationOfFace,
  neighbourFace,
  topologyForConfig,
  type CubeFace,
  type FaceDirection,
} from './topology.ts'

const DIRECTIONS: readonly FaceDirection[] = ['north', 'east', 'south', 'west']
const OPPOSITE_PAIRS: readonly (readonly [CubeFace, CubeFace])[] = [
  ['home', 'back'],
  ['up', 'down'],
  ['left', 'right'],
]

describe('main topology is frozen', () => {
  // The engine revision stays at 2 on the strength of this test. A stored match
  // reconstructs from revision + config + seed + commands, so if `main`'s
  // locations or pattern order ever move, every command-bearing replay would
  // silently reconstruct a different game. Bump the revision, do not edit here.
  it('matches the square builder exactly for a main config', () => {
    assert.deepEqual(
      topologyForConfig(DEFAULT_GAME_CONFIG),
      createTopology(DEFAULT_GAME_CONFIG.boardSize, DEFAULT_GAME_CONFIG.streak),
    )
  })

  it('still numbers a 3x3 board 0 through 8 with eight lines', () => {
    const topology = topologyForConfig(DEFAULT_GAME_CONFIG)

    assert.deepEqual([...topology.locationIds], [0, 1, 2, 3, 4, 5, 6, 7, 8])
    assert.deepEqual(topology.winningPatterns.map((pattern) => [...pattern]), [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ])
  })
})

describe('cube geometry', () => {
  it('numbers 54 locations with home first', () => {
    const topology = createCubeTopology(3)

    assert.equal(topology.locationIds.length, CUBE_LOCATION_COUNT)
    assert.deepEqual(
      [...topology.locationIds],
      Array.from({ length: CUBE_LOCATION_COUNT }, (_, index) => index),
    )
    assert.equal(faceIndex('home'), 0)
  })

  it('keeps the first face byte-identical to the main board', () => {
    const cube = createCubeTopology(3)
    const single = createTopology(3, 3)

    assert.deepEqual(
      cube.winningPatterns.slice(0, single.winningPatterns.length),
      single.winningPatterns,
    )
  })

  it('emits eight lines per face and none across a seam', () => {
    const topology = createCubeTopology(3)

    assert.equal(topology.winningPatterns.length, CUBE_FACES.length * 8)
    for (const pattern of topology.winningPatterns) {
      assert.equal(new Set(pattern.map(faceOf)).size, 1)
    }
  })

  it('round-trips every location through faceOf and cellOf', () => {
    for (let id = 0; id < CUBE_LOCATION_COUNT; id += 1) {
      assert.equal(faceIndex(faceOf(id)) * CUBE_FACE_CELLS + cellOf(id), id)
    }
    for (const face of CUBE_FACES) {
      assert.equal(faceOf(firstLocationOfFace(face)), face)
      assert.equal(cellOf(firstLocationOfFace(face)), 0)
    }
  })
})

describe('cube adjacency', () => {
  it('gives every face four distinct neighbours and never itself', () => {
    for (const face of CUBE_FACES) {
      const neighbours = DIRECTIONS.map((direction) => neighbourFace(face, direction))

      assert.equal(new Set(neighbours).size, 4)
      assert.ok(!neighbours.includes(face))
    }
  })

  it('names every face exactly four times', () => {
    const appearances = new Map<CubeFace, number>()
    for (const face of CUBE_FACES) {
      for (const direction of DIRECTIONS) {
        const neighbour = neighbourFace(face, direction)
        appearances.set(neighbour, (appearances.get(neighbour) ?? 0) + 1)
      }
    }

    for (const face of CUBE_FACES) assert.equal(appearances.get(face), 4)
  })

  it('is symmetric', () => {
    for (const face of CUBE_FACES) {
      for (const direction of DIRECTIONS) {
        const neighbour = neighbourFace(face, direction)
        const back = DIRECTIONS.map((other) => neighbourFace(neighbour, other))

        assert.ok(back.includes(face))
      }
    }
  })

  it('never puts opposite faces next to each other', () => {
    for (const [first, second] of OPPOSITE_PAIRS) {
      const neighbours = DIRECTIONS.map((direction) => neighbourFace(first, direction))

      assert.ok(!neighbours.includes(second))
    }
  })

  it('reaches every face from home in at most two steps', () => {
    const reached = new Set<CubeFace>(['home'])
    for (const direction of DIRECTIONS) {
      const first = neighbourFace('home', direction)
      reached.add(first)
      for (const second of DIRECTIONS) reached.add(neighbourFace(first, second))
    }

    assert.equal(reached.size, CUBE_FACES.length)
  })

  it('is frozen', () => {
    assert.ok(Object.isFrozen(CUBE_ADJACENCY))
    assert.ok(Object.isFrozen(CUBE_ADJACENCY.home))
  })
})

describe('topologyForConfig', () => {
  it('builds a cube for the prototype variant', () => {
    const topology = topologyForConfig(defaultConfigForVariant('prototype'))

    assert.equal(topology.locationIds.length, CUBE_LOCATION_COUNT)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace=@hidden/game-core`
Expected: FAIL — the typecheck step reports that `./topology.ts` has no exported member `CUBE_FACES`.

- [ ] **Step 4: Implement the cube in `topology.ts`**

Extend the import at the top of the file:

```ts
import { deepFreeze, type BoardSize, type GameConfig, type LocationId } from './config.ts'
```

and append:

```ts
/**
 * A face of the cube, named cube-intrinsically rather than by where it is drawn.
 *
 * `home` is where a match starts and `back` is opposite it. The names survive a
 * future re-orientable net: a face does not stop being `up` because the map
 * chose to draw it somewhere else.
 */
export type CubeFace = 'home' | 'up' | 'down' | 'left' | 'right' | 'back'

/** A side of a face, in that face's own local frame. */
export type FaceDirection = 'north' | 'east' | 'south' | 'west'

export interface FaceNeighbours {
  readonly north: CubeFace
  readonly east: CubeFace
  readonly south: CubeFace
  readonly west: CubeFace
}

/**
 * Index order, and it is load-bearing: `home` must be index 0 so that a
 * prototype match's first face occupies IDs 0..8, byte-identical to today's
 * single 3x3 board.
 */
export const CUBE_FACES: readonly CubeFace[] = deepFreeze([
  'home',
  'up',
  'down',
  'left',
  'right',
  'back',
] as CubeFace[])

export const CUBE_FACE_CELLS = 9
export const CUBE_LOCATION_COUNT = CUBE_FACES.length * CUBE_FACE_CELLS

/**
 * Derived from `home = +Z`, `up = +Y`, `right = +X`, each face viewed from
 * outside the cube.
 *
 * The unfolded map draws only 5 of the cube's 12 edges, so navigation reads this
 * table rather than the map. From `up`, west leads to `left` even though the two
 * are drawn apart.
 *
 * Seam rotation — how a cell index on one face's edge maps onto its neighbour's
 * — is deliberately not recorded, because no winning pattern crosses a seam in
 * any planned phase. If cross-face lines are ever wanted, this is the table to
 * extend rather than the geometry to re-derive.
 */
export const CUBE_ADJACENCY: Readonly<Record<CubeFace, FaceNeighbours>> = deepFreeze({
  home: { north: 'up', east: 'right', south: 'down', west: 'left' },
  up: { north: 'back', east: 'right', south: 'home', west: 'left' },
  down: { north: 'home', east: 'right', south: 'back', west: 'left' },
  left: { north: 'up', east: 'home', south: 'down', west: 'back' },
  right: { north: 'up', east: 'back', south: 'down', west: 'home' },
  back: { north: 'up', east: 'left', south: 'down', west: 'right' },
}) as Readonly<Record<CubeFace, FaceNeighbours>>

export function neighbourFace(face: CubeFace, direction: FaceDirection): CubeFace {
  return CUBE_ADJACENCY[face][direction]
}

export function faceIndex(face: CubeFace): number {
  return CUBE_FACES.indexOf(face)
}

export function firstLocationOfFace(face: CubeFace): LocationId {
  return faceIndex(face) * CUBE_FACE_CELLS
}

export function faceOf(locationId: LocationId): CubeFace {
  return CUBE_FACES[Math.floor(locationId / CUBE_FACE_CELLS)]
}

export function cellOf(locationId: LocationId): number {
  return locationId % CUBE_FACE_CELLS
}

/**
 * Six 3x3 faces laid end to end.
 *
 * Patterns are emitted face by face in the square builder's own order, so the
 * first eight are the single-board ones unchanged. That ordering is load-bearing
 * twice over: `maybeUnlockPowerup` returns on the first match, and the `main`
 * golden test compares the arrays directly.
 */
export function createCubeTopology(streak: number): ClassicTopology {
  const face = createTopology(3, streak)
  const locationIds: LocationId[] = []
  const winningPatterns: LocationId[][] = []

  for (let index = 0; index < CUBE_FACES.length; index += 1) {
    const offset = index * CUBE_FACE_CELLS
    for (const cell of face.locationIds) locationIds.push(offset + cell)
    for (const pattern of face.winningPatterns) {
      winningPatterns.push(pattern.map((cell) => offset + cell))
    }
  }

  return deepFreeze({ locationIds, winningPatterns })
}

/**
 * The board a config describes.
 *
 * The `switch` returns in every arm and has no `default`, so adding a third
 * variant is a compile error here until somebody decides what shape it is. That
 * is the whole reason the variant is a union rather than a subclass.
 */
export function topologyForConfig(config: GameConfig): ClassicTopology {
  switch (config.variant) {
    case 'main':
      return createTopology(config.boardSize, config.streak)
    case 'prototype':
      return createCubeTopology(config.streak)
  }
}
```

- [ ] **Step 5: Run the geometry tests**

Run: `npm test --workspace=@hidden/game-core`
Expected: `topology.test.ts` PASSES; `index.test.ts`'s public-surface test now FAILS, because nothing new is published yet. That is the test doing its job.

- [ ] **Step 6: Point `buildMode` at the config, and publish the new names**

In `packages/game-core/src/index.ts`, widen the topology import:

```ts
import {
  createCubeTopology,
  createTopology,
  topologyForConfig,
  type ClassicTopology,
} from './topology.ts'
```

and change `buildMode`:

```ts
function buildMode(config: GameConfig): ClassicMode {
  return deepFreeze({
    id: ENGINE_ID,
    revision: ENGINE_REVISION,
    randomAlgorithm: 'mulberry32-v1',
    // The only line in the reducer that knows a board has a shape. Everything
    // below here is opaque IDs and `winningPatterns`, both of which are data.
    topology: topologyForConfig(config),
    defeats: { rock: 'scissors', paper: 'rock', scissors: 'paper' },
    powerupBySymbol: config.powerupBySymbol,
  }) as ClassicMode
}
```

Replace the two single-line topology re-exports at the bottom of `index.ts` with:

```ts
export {
  CUBE_ADJACENCY,
  CUBE_FACES,
  CUBE_FACE_CELLS,
  CUBE_LOCATION_COUNT,
  cellOf,
  createCubeTopology,
  createTopology,
  faceIndex,
  faceOf,
  firstLocationOfFace,
  neighbourFace,
  topologyForConfig,
} from './topology.ts'
export type { ClassicTopology, CubeFace, FaceDirection, FaceNeighbours } from './topology.ts'
```

- [ ] **Step 7: Update the public-surface list and add the 54-location engine tests**

In `packages/game-core/src/index.test.ts`, add to the sorted array: `'CUBE_ADJACENCY'`, `'CUBE_FACES'`, `'CUBE_FACE_CELLS'`, `'CUBE_LOCATION_COUNT'`, `'cellOf'`, `'createCubeTopology'`, `'faceIndex'`, `'faceOf'`, `'firstLocationOfFace'`, `'neighbourFace'`, `'topologyForConfig'` — keeping it sorted, capitals before lowercase.

Then append:

```ts
describe('a prototype match runs on a cube', () => {
  it('gives each seat 54 locations', () => {
    const state = createGame(baseSpec({ config: defaultConfigForVariant('prototype') }))

    assert.equal(state.boards[0].locations.length, 54)
    assert.equal(state.boards[1].locations.length, 54)
    assert.equal(state.boards[0].locations[53].locationId, 53)
  })

  it('accepts a placement on the far face', () => {
    const state = createGame(baseSpec({ config: defaultConfigForVariant('prototype') }))
    const result = applyCommand(state, state.activeSeat, {
      type: 'place',
      locationId: 53,
      symbol: 'rock',
    })

    assert.equal(result.accepted, true)
    assert.equal(result.state.boards[state.activeSeat].locations[53].symbol, 'rock')
  })

  it('leaves a main match on nine', () => {
    const state = createGame(baseSpec())

    assert.equal(state.boards[0].locations.length, 9)
  })
})
```

- [ ] **Step 8: Run the whole suite**

Run: `npm test --workspace=@hidden/game-core`
Expected: PASS.

- [ ] **Step 9: Confirm both consumers still build and pass**

```bash
npm run build --workspace=@hidden/game-core && npm test --workspace=hidden-server && npm test --workspace=hidden-web
```

Expected: PASS. `hidden-web`'s `pretest` rebuilds `game-core` for you; the server's does not, which is why it is rebuilt explicitly first.

- [ ] **Step 10: Commit**

```bash
git add packages/game-core
git commit -m "feat(game-core): build a 54-location cube for the prototype variant

Six 3x3 faces, locationId = faceIndex * 9 + cellIndex, with home at
index 0 so the first face is byte-identical to today's board. Adjacency
is a static 24-entry table in each face's local frame. ENGINE_REVISION
stays at 2; the golden test is what that rests on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `BoardGrid` is told its layout

`boardColumns()` guesses the column count from `Math.round(Math.sqrt(cellCount))`. A 54-cell board would render as seven columns. The renderer gets told instead, and gains the two things a face needs: an offset, so a slice of a larger board still reports true location IDs, and a slot for the arrows.

No cube code here. `main` must come out of this task pixel-identical.

**Files:**
- Modify: `web/src/components/BoardGrid.tsx`
- Modify: `web/src/components/RevealSnapshot.tsx`
- Modify: `web/src/App.tsx` (call sites only)
- Test: `web/src/components/__tests__/BoardGrid.test.ts`
- Test: `web/src/components/__tests__/RevealSnapshot.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BoardGridProps` gains `columns: number` (required), `indexOffset?: number` (default `0`), `navigation?: ReactNode`. `boardColumns` is deleted. `RevealSnapshotProps` gains `columns: number` and `indexOffset?: number`.

- [ ] **Step 1: Write the failing tests**

In `web/src/components/__tests__/BoardGrid.test.ts`, replace both the top-level `markupFor` helper and the `board grid sizing` block, then add the rest:

```ts
const markupFor = (count: number, columns: number) =>
  renderToStaticMarkup(
    createElement(BoardGrid, {
      title: '',
      subtitle: 'Board',
      grid: gridOf(count),
      columns,
    }),
  )

describe('board grid sizing', () => {
  it.each([
    [9, 3],
    [16, 4],
    [25, 5],
  ])('renders %i cells in the %i columns it was given', (count, columns) => {
    expect(markupFor(count, columns)).toContain(`--board-size:${columns}`)
  })

  it('does not infer a column count from the cell count', () => {
    // A cube face is nine cells out of fifty-four. Inferring would have drawn a
    // whole cube as a seven-column rectangle the moment a board became a slice.
    expect(markupFor(9, 3)).toContain('--board-size:3')
  })
})

describe('index offset', () => {
  const render = (indexOffset: number) =>
    renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Board',
        grid: gridOf(9),
        columns: 3,
        indexOffset,
      }),
    )

  it('numbers cells from the offset so a face reports true location ids', () => {
    const markup = render(45)

    expect(markup).toContain('aria-label="Cell 46"')
    expect(markup).toContain('aria-label="Cell 54"')
    expect(markup).not.toContain('aria-label="Cell 1"')
  })

  it('starts at one when there is no offset', () => {
    expect(render(0)).toContain('aria-label="Cell 1"')
  })
})

describe('navigation slot', () => {
  it('frames the grid when navigation is supplied', () => {
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Board',
        grid: gridOf(9),
        columns: 3,
        navigation: createElement('b', { className: 'probe' }),
      }),
    )

    expect(markup).toContain('face-frame')
    expect(markup).toContain('probe')
  })

  it('leaves the grid unframed otherwise', () => {
    // `main` has to come out of this task pixel-identical, and the arena's CSS
    // reaches the grid as a direct child of `.hidden-board`.
    expect(markupFor(9, 3)).not.toContain('face-frame')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace=hidden-web -- BoardGrid`
Expected: FAIL — `columns` is not a known prop and `face-frame` is not in the markup.

- [ ] **Step 3: Implement in `BoardGrid.tsx`**

Delete `boardColumns` entirely. Change the type import to `import type { CSSProperties, ReactNode } from 'react'`. Add to `BoardGridProps`:

```ts
  /**
   * How many columns to draw. Passed rather than derived: a cube face is a
   * nine-cell slice of a fifty-four-cell board, and `sqrt(cellCount)` cannot
   * tell a board from a window onto one.
   */
  columns: number
  /**
   * The location ID of `grid.cells[0]`. Zero for a whole board; `faceIndex * 9`
   * for a cube face. Everything a caller keys by location — `onSelect`,
   * destruction effects, score labels — speaks absolute IDs, so the renderer
   * adds the offset back rather than making five call sites subtract it.
   */
  indexOffset?: number
  /** The face arrows, when this board is one face of a cube. */
  navigation?: ReactNode
```

Add `columns,`, `indexOffset = 0,` and `navigation,` to the destructured signature.

Replace `'--board-size': String(boardColumns(grid.cells.length))` with `'--board-size': String(columns)`.

Inside the cell map, derive the location once and use it everywhere an index was used:

```ts
        {grid.cells.map((cell, index) => {
          const locationId = indexOffset + index
          const isClickable = interactive && typeof onSelect === 'function'
          const destructionEffect = destructionEffects[locationId]
          const scoreCount = scoreCountLabels[locationId]
```

then in the button: `onClick={() => onSelect?.(locationId)}`, the two `aria-label` branches read `Cell ${locationId + 1}`, and the variant class becomes `hidden-cell-v${cellVariant(locationId)}`.

> `cellVariant(locationId)` rather than `cellVariant(index)` is deliberate: with the offset, no two faces stamp their hand-cut edges in the same order, so a cube does not read as the same nine squares six times. For `main` the offset is 0 and the cut is unchanged.

`key={index}` stays as the array index — it is a position in this render's list, not a location.

Finally, frame the grid. Extract the existing `<div className="hidden-board-grid">…</div>` into `const gridElement = (…)` above the `return`, and render in its place:

```tsx
      {navigation ? (
        <div className="face-frame">
          {navigation}
          {gridElement}
        </div>
      ) : (
        gridElement
      )}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace=hidden-web -- BoardGrid`
Expected: PASS.

- [ ] **Step 5: Pass `columns` at every call site**

`tsc` lists them. They are:

- `web/src/components/RevealSnapshot.tsx` — add `columns: number` and `indexOffset?: number` to `RevealSnapshotProps` and pass both straight through to its `BoardGrid`.
- `web/src/App.tsx` — four `BoardGrid` uses (player board, opponent peek, two result boards) and one `RevealSnapshot`. All take `columns={match.config.boardSize}`.

In `web/src/components/__tests__/RevealSnapshot.test.ts`, add `columns: 3` to the props each render helper builds.

- [ ] **Step 6: Verify the whole web package**

```bash
npm test --workspace=hidden-web && npm run lint --workspace=hidden-web && npm run build --workspace=hidden-web
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "refactor(web): give BoardGrid its layout instead of inferring it

sqrt(cellCount) cannot tell a board from a window onto one, and a cube
face is nine cells out of fifty-four. Adds an index offset so a slice
still reports true location ids, and a slot for the face arrows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The camera as a pure module

Which face you are looking at, and whether navigation is switched on. Pure functions with no React and no DOM, so the navigation rules are tested directly rather than through a rendered component.

**Files:**
- Create: `web/src/game/faceNavigation.ts`
- Test: `web/src/game/__tests__/faceNavigation.test.ts`

**Interfaces:**
- Consumes: `CubeFace`, `FaceDirection`, `CUBE_FACES`, `CUBE_FACE_CELLS`, `neighbourFace`, `firstLocationOfFace` from `@hidden/game-core` (Task 2); `GridState` from `./types`.
- Produces:
  - `interface FaceCamera { readonly face: CubeFace; readonly locked: boolean }`
  - `const INITIAL_FACE_CAMERA: FaceCamera`
  - `const CROSS_LAYOUT: readonly (CubeFace | null)[]` — 12 slots, 3 columns by 4 rows
  - `const FACE_LABELS: Readonly<Record<CubeFace, string>>`
  - `function directionForKey(key: string): FaceDirection | null`
  - `function moveCamera(camera: FaceCamera, direction: FaceDirection): FaceCamera`
  - `function jumpCamera(camera: FaceCamera, face: CubeFace): FaceCamera`
  - `function toggleCameraLock(camera: FaceCamera): FaceCamera`
  - `function faceCells(grid: GridState, face: CubeFace): GridState`
  - `function faceCellCounts(grid: GridState): Record<CubeFace, number>`

- [ ] **Step 1: Write the failing tests**

Create `web/src/game/__tests__/faceNavigation.test.ts`:

```ts
import { CUBE_FACES, neighbourFace, type CubeFace, type FaceDirection } from '@hidden/game-core'
import { describe, expect, it } from 'vitest'
import {
  CROSS_LAYOUT,
  INITIAL_FACE_CAMERA,
  directionForKey,
  faceCellCounts,
  faceCells,
  jumpCamera,
  moveCamera,
  toggleCameraLock,
} from '../faceNavigation'
import type { GridState } from '../types'

const DIRECTIONS: readonly FaceDirection[] = ['north', 'east', 'south', 'west']

const cubeGrid = (occupied: readonly number[] = []): GridState => ({
  cells: Array.from({ length: 54 }, (_, index) => ({
    occupied: occupied.includes(index),
    symbol: occupied.includes(index) ? ('rock' as const) : null,
    immune: false,
    desecrated: false,
  })),
})

describe('keys', () => {
  it.each([
    ['ArrowUp', 'north'],
    ['ArrowRight', 'east'],
    ['ArrowDown', 'south'],
    ['ArrowLeft', 'west'],
    ['w', 'north'],
    ['d', 'east'],
    ['s', 'south'],
    ['a', 'west'],
  ])('maps %s to %s', (key, direction) => {
    expect(directionForKey(key)).toBe(direction)
  })

  it('accepts WASD with caps lock on', () => {
    expect(directionForKey('W')).toBe('north')
  })

  it('claims nothing else', () => {
    expect(directionForKey('Enter')).toBeNull()
    expect(directionForKey('q')).toBeNull()
    expect(directionForKey(' ')).toBeNull()
  })
})

describe('moving', () => {
  it('starts on home, unlocked', () => {
    expect(INITIAL_FACE_CAMERA).toEqual({ face: 'home', locked: false })
  })

  it('follows the cube adjacency, not the map', () => {
    // `up` and `left` are drawn apart on the cross and are neighbours on the
    // cube. This is the case that proves the map is only a picture.
    expect(moveCamera({ face: 'up', locked: false }, 'west').face).toBe('left')
    expect(neighbourFace('up', 'west')).toBe('left')
  })

  it.each(CUBE_FACES)('returns to %s after stepping off and back', (face) => {
    const out = moveCamera({ face, locked: false }, 'east')
    const backDirection = DIRECTIONS.find(
      (direction) => neighbourFace(out.face, direction) === face,
    )

    expect(backDirection).toBeDefined()
    expect(moveCamera(out, backDirection as FaceDirection).face).toBe(face)
  })

  it('jumps straight to a face', () => {
    expect(jumpCamera(INITIAL_FACE_CAMERA, 'back').face).toBe('back')
  })
})

describe('the lock', () => {
  it('toggles', () => {
    const locked = toggleCameraLock(INITIAL_FACE_CAMERA)

    expect(locked.locked).toBe(true)
    expect(toggleCameraLock(locked).locked).toBe(false)
  })

  it('keeps the face it was locked on', () => {
    expect(toggleCameraLock({ face: 'right', locked: false }).face).toBe('right')
  })

  it('refuses every move while locked', () => {
    const locked: FaceCamera = { face: 'home', locked: true }

    expect(moveCamera(locked, 'north')).toBe(locked)
    expect(jumpCamera(locked, 'back')).toBe(locked)
  })
})

describe('slicing a board into faces', () => {
  it('hands back the nine cells of the face', () => {
    const slice = faceCells(cubeGrid([45, 53]), 'back')

    expect(slice.cells).toHaveLength(9)
    expect(slice.cells[0].occupied).toBe(true)
    expect(slice.cells[8].occupied).toBe(true)
    expect(slice.cells[4].occupied).toBe(false)
  })

  it("counts each face's own occupied cells", () => {
    const counts = faceCellCounts(cubeGrid([0, 1, 2, 45]))

    expect(counts.home).toBe(3)
    expect(counts.back).toBe(1)
    expect(counts.up).toBe(0)
  })
})

describe('the unfolded cross', () => {
  it('lays out three columns by four rows with the six faces placed', () => {
    expect(CROSS_LAYOUT).toHaveLength(12)
    expect(CROSS_LAYOUT.filter(Boolean)).toHaveLength(6)
    expect(CROSS_LAYOUT[1]).toBe('up')
    expect(CROSS_LAYOUT[3]).toBe('left')
    expect(CROSS_LAYOUT[4]).toBe('home')
    expect(CROSS_LAYOUT[5]).toBe('right')
    expect(CROSS_LAYOUT[7]).toBe('down')
    expect(CROSS_LAYOUT[10]).toBe('back')
  })
})
```

Add `import type { FaceCamera } from '../faceNavigation'` alongside the value import — the lock suite annotates with it.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=hidden-web -- faceNavigation`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `web/src/game/faceNavigation.ts`**

```ts
import {
  CUBE_FACES,
  CUBE_FACE_CELLS,
  firstLocationOfFace,
  neighbourFace,
  type CubeFace,
  type FaceDirection,
} from '@hidden/game-core'
import type { GridState } from './types'

/**
 * Which face this player is looking at, and whether they can leave it.
 *
 * A camera, not game state. Two players may look at different faces at the same
 * moment, and neither knows where the other is standing — putting this in
 * `GameState` would serialise it, send it to the opponent, and leak position in
 * a mode whose whole premise is a hidden board.
 *
 * `locked` is the Phase 1 debug switch. It is presentation *and* input: while it
 * is on, the arrows, the map, and the keys all refuse, so the shape of Phase 2
 * can be felt before any rule exists. It still touches no `GameState`, sends no
 * packet, and gates no placement — every one of the 54 locations is legal. The
 * two players' switches are independent, which is correct: either can inspect
 * the locked treatment without disturbing the other's match.
 */
export interface FaceCamera {
  readonly face: CubeFace
  readonly locked: boolean
}

export const INITIAL_FACE_CAMERA: FaceCamera = { face: 'home', locked: false }

/**
 * The Latin cross, read left to right and top to bottom over a 3x4 grid:
 *
 * ```
 *         [ up  ]
 * [left ] [home ] [right]
 *         [down ]
 *         [back ]
 * ```
 *
 * A picture of the cube, and only that. It draws 5 of the cube's 12 edges, so
 * `moveCamera` reads the adjacency table instead — from `up`, west leads to
 * `left` even though the cross draws the two apart.
 */
export const CROSS_LAYOUT: readonly (CubeFace | null)[] = [
  null, 'up', null,
  'left', 'home', 'right',
  null, 'down', null,
  null, 'back', null,
]

/** Words rather than initials. A map tile has room for four characters, and
 * `B` would have to serve both `back` and nothing else in a mode that will
 * eventually also want `blocked`. */
export const FACE_LABELS: Readonly<Record<CubeFace, string>> = {
  home: 'HOME',
  up: 'UP',
  down: 'DOWN',
  left: 'LEFT',
  right: 'RIGHT',
  back: 'BACK',
}

// Both schemes, because both are muscle memory and the spec asks for them to be
// equivalent rather than ranked.
const KEY_DIRECTIONS: Readonly<Record<string, FaceDirection>> = {
  ArrowUp: 'north',
  ArrowRight: 'east',
  ArrowDown: 'south',
  ArrowLeft: 'west',
  w: 'north',
  d: 'east',
  s: 'south',
  a: 'west',
}

export function directionForKey(key: string): FaceDirection | null {
  return KEY_DIRECTIONS[key] ?? KEY_DIRECTIONS[key.toLowerCase()] ?? null
}

// Returns the same object when nothing moves, so a React state setter bails out
// rather than re-rendering the board on every refused key.
export function moveCamera(camera: FaceCamera, direction: FaceDirection): FaceCamera {
  if (camera.locked) return camera
  return { ...camera, face: neighbourFace(camera.face, direction) }
}

export function jumpCamera(camera: FaceCamera, face: CubeFace): FaceCamera {
  if (camera.locked || camera.face === face) return camera
  return { ...camera, face }
}

export function toggleCameraLock(camera: FaceCamera): FaceCamera {
  return { ...camera, locked: !camera.locked }
}

/**
 * One face's nine cells, as a grid the renderer can take.
 *
 * The caller pairs this with `firstLocationOfFace(face)` as `BoardGrid`'s
 * `indexOffset`, which is what keeps `onSelect` speaking absolute location IDs.
 */
export function faceCells(grid: GridState, face: CubeFace): GridState {
  const start = firstLocationOfFace(face)
  return { cells: grid.cells.slice(start, start + CUBE_FACE_CELLS) }
}

/**
 * How many cells this player holds on each face.
 *
 * Only ever called with the player's own board. Their own placements are not
 * hidden information, and without this the map is a radio button group: a face
 * you have not visited in six turns reads as inert whether or not you own it.
 */
export function faceCellCounts(grid: GridState): Record<CubeFace, number> {
  const counts = {} as Record<CubeFace, number>
  for (const face of CUBE_FACES) {
    counts[face] = faceCells(grid, face).cells.filter((cell) => cell.occupied).length
  }
  return counts
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace=hidden-web -- faceNavigation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/game/faceNavigation.ts web/src/game/__tests__/faceNavigation.test.ts
git commit -m "feat(web): add the cube face camera as a pure module

Which face you are looking at and whether you can leave it. Client-only
by construction: it never enters GameState and never crosses the wire,
because where a player is standing is exactly what a hidden board hides.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The brace arrows

**Load the `frontend-design` skill before writing this task's code.**

Four arrows, one per side, outside the board. The glyph is a brace — `{` and `}` — drawn as a tapered fill rather than a stroked line, so it reads as a brush mark in the same family as the board's hand-cut cells rather than as a UI chevron. One path, rotated for the other three sides.

**Design direction, decided:**

| | resting | hover / focus | locked |
|---|---|---|---|
| ink | `#5e5e5e` | `#c9c9c9` | `#5e5e5e` at `opacity: 0.32` |
| motion | — | 2px outward, along its own direction | none |

Dark grey and not white, because these are chrome around the board and the board's own `#f5f5f5` cells must stay the brightest thing on screen. Reduced alpha has to mean *you cannot go there*, which is why the resting state cannot already be dim. The hit target is `clamp(2.25rem, 7vmin, 3rem)` square — sized for a thumb, not for the glyph.

This is the first inline SVG in the codebase; every other icon is a PNG. It is the right tool here because the same mark has to rotate four ways and recolour on three states, and because a 200-byte path beats four raster assets.

**Files:**
- Create: `web/src/components/FaceArrows.tsx`
- Modify: `web/src/prototype-mode.css`
- Test: `web/src/components/__tests__/FaceArrows.test.ts`

**Interfaces:**
- Consumes: `CubeFace`, `FaceDirection`, `neighbourFace` from `@hidden/game-core`; `FACE_LABELS` from `../game/faceNavigation`.
- Produces: `function FaceArrows(props: { face: CubeFace; locked: boolean; onMove: (direction: FaceDirection) => void })`, rendering four `<button class="face-arrow face-arrow-{direction}">`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/__tests__/FaceArrows.test.ts`. It opens in jsdom, unlike the other component tests in this plan, because the spec asks for arrow taps and key presses to be proven equivalent and a tap has to actually be dispatched for that:

```ts
/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { FaceArrows } from '../FaceArrows'
import type { FaceDirection } from '@hidden/game-core'

const render = (locked: boolean) =>
  renderToStaticMarkup(
    createElement(FaceArrows, { face: 'home' as const, locked, onMove: () => {} }),
  )

describe('face arrows', () => {
  it('draws one per side', () => {
    const markup = render(false)

    for (const direction of ['north', 'east', 'south', 'west']) {
      expect(markup).toContain(`face-arrow-${direction}`)
    }
  })

  it('names its destination', () => {
    // The adjacency table is public geometry, so saying where an arrow goes
    // leaks nothing and is the only way the control has an accessible name.
    const markup = render(false)

    expect(markup).toContain('aria-label="Move to UP"')
    expect(markup).toContain('aria-label="Move to RIGHT"')
  })

  it('stays visible and stops working when navigation is locked', () => {
    // Not hidden. A missing arrow reads as "no face there", which is wrong on a
    // cube where every face has four neighbours.
    const markup = render(true)

    expect(markup).toContain('face-arrow-locked')
    expect(markup.match(/disabled/g)).toHaveLength(4)
    expect(markup).toContain('face-arrow-north')
  })

  it('is enabled when navigation is open', () => {
    const markup = render(false)

    expect(markup).not.toContain('disabled')
    expect(markup).not.toContain('face-arrow-locked')
  })
})

describe('tapping an arrow', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  const mount = (locked: boolean) => {
    const moves: FaceDirection[] = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        createElement(FaceArrows, {
          face: 'home' as const,
          locked,
          onMove: (direction: FaceDirection) => moves.push(direction),
        }),
      )
    })
    return moves
  }

  const tap = (direction: FaceDirection) => {
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(`.face-arrow-${direction}`)
        ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
  }

  it.each(['north', 'east', 'south', 'west'] as const)(
    'reports %s, the same vocabulary the keyboard uses',
    (direction) => {
      // `useFaceCamera` hands both this callback and `directionForKey` to the
      // same `move`, so proving the tap emits the same name is what makes the
      // three input paths equivalent rather than merely similar.
      const moves = mount(false)

      tap(direction)
      expect(moves).toEqual([direction])
    },
  )

  it('reports nothing while navigation is locked', () => {
    const moves = mount(true)

    tap('north')
    expect(moves).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=hidden-web -- FaceArrows`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/FaceArrows.tsx`**

```tsx
import '../prototype-mode.css'
import { neighbourFace, type CubeFace, type FaceDirection } from '@hidden/game-core'
import { FACE_LABELS } from '../game/faceNavigation'

const DIRECTIONS: readonly FaceDirection[] = ['north', 'east', 'south', 'west']

/*
 * A brace, drawn as a filled outline rather than a stroked line.
 *
 * A stroke has one weight everywhere and reads as a bracket. This path's two
 * edges converge at both terminals and part at the cusp, so the mark thins,
 * swells, and thins again the way a brush does — which is the board's own
 * language, and the reason these are braces and not chevrons.
 *
 * Drawn once, pointing east, and rotated by CSS for the other three. The
 * viewBox is tall and the button is square, so the default `meet` fit centres
 * the mark and every side gets the same glyph at the same scale.
 */
const BRACE_PATH =
  'M4 1.5C13.5 8.5 10.5 24 20.5 32C10.5 40 13.5 55.5 4 62.5L5.2 60.8' +
  'C13.2 54 10.2 39.5 16.8 32C10.2 24.5 13.2 10 5.2 3.2Z'

interface FaceArrowsProps {
  face: CubeFace
  locked: boolean
  onMove: (direction: FaceDirection) => void
}

/**
 * The four ways off this face.
 *
 * Drawn from `CUBE_ADJACENCY`, not from the map, so west from `up` offers
 * `left` even though the cross draws the two apart.
 */
export function FaceArrows({ face, locked, onMove }: FaceArrowsProps) {
  return (
    <>
      {DIRECTIONS.map((direction) => (
        <button
          key={direction}
          type="button"
          className={`face-arrow face-arrow-${direction} ${locked ? 'face-arrow-locked' : ''}`}
          disabled={locked}
          onClick={() => onMove(direction)}
          aria-label={`Move to ${FACE_LABELS[neighbourFace(face, direction)]}`}
        >
          <svg viewBox="0 0 24 64" aria-hidden="true" focusable="false">
            <path d={BRACE_PATH} />
          </svg>
        </button>
      ))}
    </>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace=hidden-web -- FaceArrows`
Expected: PASS.

- [ ] **Step 5: Add the frame and arrow CSS**

Append to `web/src/prototype-mode.css`:

```css
/*
 * The played face, framed by its four exits.
 *
 * A three-by-three frame with the board in the middle cell, rather than arrows
 * floated over the arena. The board is sized from leftover height, so anything
 * positioned against it would have to be measured first; giving the arrows real
 * tracks lets the board shrink by exactly the room they take, and nothing has to
 * know anyone's pixel width.
 */
.face-frame {
  --face-arrow: clamp(2.25rem, 7vmin, 3rem);
  --face-arrow-gap: clamp(0.25rem, 1vmin, 0.5rem);
  display: grid;
  grid-template-columns: var(--face-arrow) minmax(0, 1fr) var(--face-arrow);
  grid-template-rows: var(--face-arrow) minmax(0, 1fr) var(--face-arrow);
  gap: var(--face-arrow-gap);
  place-items: center;
}

/* Reproduces the rules the arena applies to an unframed board, which reach it as
 * a direct child and stop matching once the frame is between them. */
.battle-arena > .hidden-board > .face-frame {
  height: 100%;
  min-height: 0;
  width: 100%;
}

.face-frame > .hidden-board-grid {
  grid-area: 2 / 2;
  height: 100%;
  max-height: 29rem;
  min-height: 0;
  width: auto;
  max-width: 100%;
  aspect-ratio: 1;
  grid-template-rows: repeat(var(--board-size, 3), minmax(0, 1fr));
}

.face-arrow {
  display: grid;
  width: var(--face-arrow);
  height: var(--face-arrow);
  padding: 0;
  border: 0;
  background: none;
  /* Dark grey, not white. These sit around the board, and the board's own cells
   * have to stay the brightest thing on screen. */
  color: #5e5e5e;
  cursor: pointer;
  place-items: center;
  transition:
    color 140ms ease,
    opacity 140ms ease,
    translate 140ms ease;
}

.face-arrow svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.face-arrow-north { grid-area: 1 / 2; rotate: -90deg; }
.face-arrow-east  { grid-area: 2 / 3; }
.face-arrow-south { grid-area: 3 / 2; rotate: 90deg; }
.face-arrow-west  { grid-area: 2 / 1; rotate: 180deg; }

/* The nudge goes the way the arrow points. `rotate` already turned the box, so
 * the movement is always +x in the rotated frame — every arrow points east
 * before it is turned. */
.face-arrow:hover:not(:disabled),
.face-arrow:focus-visible {
  color: #c9c9c9;
  translate: 2px 0;
}

.face-arrow:active:not(:disabled) {
  color: var(--hidden-white);
}

.face-arrow:focus-visible {
  outline: 3px solid var(--hidden-yellow);
  outline-offset: 2px;
}

/*
 * Locked is the same mark at lower alpha, never a missing one. Every face on a
 * cube has four neighbours, so an absent arrow would say something false.
 */
.face-arrow-locked {
  opacity: 0.32;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .face-arrow {
    transition: color 140ms ease;
  }

  .face-arrow:hover:not(:disabled),
  .face-arrow:focus-visible {
    translate: none;
  }
}
```

- [ ] **Step 6: Verify the package**

```bash
npm test --workspace=hidden-web && npm run lint --workspace=hidden-web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/FaceArrows.tsx web/src/components/__tests__/FaceArrows.test.ts web/src/prototype-mode.css
git commit -m "feat(web): draw the four face exits as brace arrows

A tapered fill rather than a stroked chevron, so the mark thins and
swells like the board's own hand-cut edges. Dark grey because the cells
have to stay the brightest thing on screen, which is also what lets
reduced alpha mean you cannot go there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The unfolded map and the padlock

**Load the `frontend-design` skill before writing this task's code.**

The Latin cross, with the current face marked, every face a jump target, each tile carrying how many cells the player holds there, and one padlock that switches navigation off.

**Design direction, decided:** the map stays flat and quiet — hairline borders, no hand-cut edges — because the braces are already carrying this mode's one visual idea and a second would be one accessory too many. The padlock is the only colour in the whole frame: green for open, red for locked. Colour is not the only carrier, following the precedent `.mode-select-dot` sets in this same file — the body fills when locked and is hollow when open, and a mono word beside it says `OPEN` or `LOCKED` outright. It is a debug control and should look like one.

**Files:**
- Create: `web/src/components/CubeMap.tsx`
- Modify: `web/src/prototype-mode.css`
- Test: `web/src/components/__tests__/CubeMap.test.ts`

**Interfaces:**
- Consumes: `CubeFace` from `@hidden/game-core`; `CROSS_LAYOUT`, `FACE_LABELS` from `../game/faceNavigation`.
- Produces: `function CubeMap(props: { face: CubeFace; locked: boolean; cellCounts: Readonly<Record<CubeFace, number>>; onJump: (face: CubeFace) => void; onToggleLock: () => void })`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/__tests__/CubeMap.test.ts`:

```ts
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CubeMap } from '../CubeMap'
import type { CubeFace } from '@hidden/game-core'

const counts: Record<CubeFace, number> = {
  home: 3,
  up: 0,
  down: 1,
  left: 0,
  right: 0,
  back: 9,
}

const render = (face: CubeFace, locked: boolean) =>
  renderToStaticMarkup(
    createElement(CubeMap, {
      face,
      locked,
      cellCounts: counts,
      onJump: () => {},
      onToggleLock: () => {},
    }),
  )

describe('the map', () => {
  it('lays out all six faces', () => {
    const markup = render('home', false)

    for (const label of ['HOME', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'BACK']) {
      expect(markup).toContain(label)
    }
  })

  it('marks where you are', () => {
    const markup = render('right', false)

    expect(markup).toContain('cube-map-face-current')
    expect(markup).toContain('aria-current="true"')
  })

  it('shows how many cells you hold on each face', () => {
    // The player's own placements. Nothing here is the opponent's, so the map
    // leaks nothing a blind board is hiding.
    expect(render('home', false)).toContain('>9<')
  })

  it('stops being a jump target while navigation is locked', () => {
    const markup = render('home', true)

    expect(markup).toContain('cube-map-locked')
    expect(markup.match(/<button[^>]*disabled/g)).toHaveLength(6)
  })
})

describe('the padlock', () => {
  it('reports open state in words as well as colour', () => {
    const markup = render('home', false)

    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('OPEN')
    expect(markup).not.toContain('padlock-locked')
  })

  it('reports locked state in words as well as colour', () => {
    const markup = render('home', true)

    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('LOCKED')
    expect(markup).toContain('padlock-locked')
  })

  it('stays usable while navigation is locked, or there is no way back', () => {
    const padlock = render('home', true).match(/<button[^>]*class="padlock[^>]*>/)

    expect(padlock).not.toBeNull()
    expect(padlock?.[0]).not.toContain('disabled')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=hidden-web -- CubeMap`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/CubeMap.tsx`**

```tsx
import '../prototype-mode.css'
import { CROSS_LAYOUT, FACE_LABELS } from '../game/faceNavigation'
import type { CubeFace } from '@hidden/game-core'

/*
 * A closed padlock. One glyph for both states: the shackle never opens, the body
 * fills, and the colour turns over. Two glyphs would be two things to read where
 * one already says it, and the word beside it settles any ambiguity.
 */
const PADLOCK_SHACKLE = 'M7 9V6.5a5 5 0 0 1 10 0V9'
const PADLOCK_BODY = 'M4.5 9h15v12.5h-15z'

interface CubeMapProps {
  face: CubeFace
  locked: boolean
  /** The player's own occupied cells per face. Never the opponent's. */
  cellCounts: Readonly<Record<CubeFace, number>>
  onJump: (face: CubeFace) => void
  onToggleLock: () => void
}

/**
 * The cube, unfolded, plus the switch that decides whether you can leave a face.
 *
 * The cross draws 5 of the cube's 12 edges, so this is a picture and not the
 * navigation model — `moveCamera` reads the adjacency table. Jumping by tile is
 * offered anyway, because "take me to BACK" is two arrow presses and one
 * decision, and the decision is the part worth keeping.
 */
export function CubeMap({ face, locked, cellCounts, onJump, onToggleLock }: CubeMapProps) {
  return (
    <section className={`cube-map ${locked ? 'cube-map-locked' : ''}`} aria-label="Cube map">
      <header className="cube-map-header">
        <p>CUBE</p>
        <button
          type="button"
          className={`padlock ${locked ? 'padlock-locked' : ''}`}
          aria-pressed={locked}
          onClick={onToggleLock}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path className="padlock-shackle" d={PADLOCK_SHACKLE} />
            <path className="padlock-body" d={PADLOCK_BODY} />
          </svg>
          <span>{locked ? 'LOCKED' : 'OPEN'}</span>
        </button>
      </header>

      <div className="cube-map-grid">
        {CROSS_LAYOUT.map((slot, index) =>
          slot === null ? (
            <span key={index} className="cube-map-blank" aria-hidden="true" />
          ) : (
            <button
              key={index}
              type="button"
              className={`cube-map-face ${slot === face ? 'cube-map-face-current' : ''}`}
              disabled={locked}
              aria-current={slot === face ? true : undefined}
              onClick={() => onJump(slot)}
            >
              <span className="cube-map-label">{FACE_LABELS[slot]}</span>
              <span className="cube-map-count">{cellCounts[slot]}</span>
            </button>
          ),
        )}
      </div>

      <p className="cube-map-note">
        Debug switch. Locking is not a rule yet — every face is playable.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace=hidden-web -- CubeMap`
Expected: PASS.

- [ ] **Step 5: Add the map CSS**

Append to `web/src/prototype-mode.css`:

```css
/*
 * The unfolded cube, sitting above the power-up tray.
 *
 * Flat on purpose. The braces already carry this mode's one visual idea, and a
 * second hand-cut surface next to the board would compete with the board.
 */
.cube-map {
  --map-tile: clamp(2.2rem, 8vw, 2.9rem);
  display: grid;
  justify-items: center;
  gap: 0.4rem;
  width: 100%;
}

.cube-map-header {
  display: flex;
  width: calc(var(--map-tile) * 3 + 0.6rem);
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.cube-map-header p {
  margin: 0;
  color: var(--hidden-muted);
  font-size: 0.55rem;
  letter-spacing: 0.2em;
}

.cube-map-grid {
  display: grid;
  grid-template-columns: repeat(3, var(--map-tile));
  gap: 0.3rem;
}

.cube-map-blank {
  display: block;
}

.cube-map-face {
  display: grid;
  aspect-ratio: 1;
  align-content: center;
  justify-items: center;
  gap: 0.1rem;
  padding: 0;
  border: 1px solid #3a3a3a;
  background: #0d0d0d;
  color: #8a8a8a;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    color 140ms ease;
}

.cube-map-face:hover:not(:disabled) {
  border-color: #565656;
  background: #1c1c1c;
  color: var(--hidden-white);
}

.cube-map-face:focus-visible {
  outline: 3px solid var(--hidden-yellow);
  outline-offset: 2px;
}

/* Yellow, not red. Where you are standing is a selection, and selection is
 * yellow everywhere in Hidden; the red in this mode means "not finished". */
.cube-map-face-current {
  border-color: var(--hidden-yellow);
  background: #171308;
  color: var(--hidden-white);
}

.cube-map-label {
  font-size: 0.45rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.cube-map-count {
  font-size: 0.7rem;
  line-height: 1;
}

.cube-map-locked .cube-map-face {
  opacity: 0.32;
  cursor: not-allowed;
}

.cube-map-note {
  margin: 0;
  max-width: calc(var(--map-tile) * 3 + 0.6rem);
  color: var(--hidden-muted);
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.4;
  text-align: center;
}

/*
 * The one piece of colour in the whole frame. It has to survive without hue as
 * well: the body fills when locked, and the word says which it is.
 */
.padlock {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.35rem;
  border: 1px solid currentColor;
  background: none;
  color: var(--hidden-green);
  cursor: pointer;
  font-family: var(--font-block);
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  transition:
    color 140ms ease,
    background 140ms ease;
}

.padlock svg {
  width: 0.85rem;
  height: 0.85rem;
}

.padlock-shackle,
.padlock-body {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

.padlock-locked {
  color: var(--hidden-red);
}

.padlock-locked .padlock-body {
  fill: currentColor;
}

.padlock:hover {
  background: #1c1c1c;
}

.padlock:focus-visible {
  outline: 3px solid var(--hidden-yellow);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .cube-map-face,
  .padlock {
    transition: none;
  }
}
```

- [ ] **Step 6: Verify the package**

```bash
npm test --workspace=hidden-web && npm run lint --workspace=hidden-web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/CubeMap.tsx web/src/components/__tests__/CubeMap.test.ts web/src/prototype-mode.css
git commit -m "feat(web): add the unfolded cube map and the navigation padlock

The cross with the current face marked, each tile carrying how many
cells you hold there so a far face is not inert. The padlock is the only
colour in the frame, and it carries its state in fill and in a word as
well as in hue.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The camera hook and the keyboard

One hook owns the camera and the window keydown listener, so `App.tsx` gains one line rather than three more `useState` calls in a scope that already has 28.

**Files:**
- Create: `web/src/hooks/useFaceCamera.ts`
- Test: `web/src/hooks/__tests__/useFaceCamera.test.ts`

**Interfaces:**
- Consumes: Task 4's `faceNavigation` module.
- Produces:
  ```ts
  export interface FaceCameraControls {
    readonly camera: FaceCamera
    readonly move: (direction: FaceDirection) => void
    readonly jump: (face: CubeFace) => void
    readonly toggleLock: () => void
  }
  export function useFaceCamera(active: boolean): FaceCameraControls
  ```

- [ ] **Step 1: Write the failing tests**

Create `web/src/hooks/__tests__/useFaceCamera.test.ts`:

```ts
/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useFaceCamera, type FaceCameraControls } from '../useFaceCamera'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(active: boolean) {
  let controls: FaceCameraControls | null = null

  function Probe({ isActive }: { isActive: boolean }) {
    controls = useFaceCamera(isActive)
    return null
  }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(createElement(Probe, { isActive: active }))
  })

  return () => controls as FaceCameraControls
}

function press(key: string, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

describe('useFaceCamera', () => {
  it('starts on home', () => {
    const controls = mount(true)

    expect(controls().camera).toEqual({ face: 'home', locked: false })
  })

  it('moves on arrow keys', () => {
    const controls = mount(true)

    press('ArrowUp')
    expect(controls().camera.face).toBe('up')
    press('ArrowRight')
    expect(controls().camera.face).toBe('right')
  })

  it('moves on WASD', () => {
    const controls = mount(true)

    press('a')
    expect(controls().camera.face).toBe('left')
  })

  it('takes the arrow key away from the page', () => {
    mount(true)
    const event = new window.KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores keys typed into a field', () => {
    // The battle screen has no text input today, but the listener is on
    // `window` and the account and lobby screens do. A hook that ate "a" would
    // be a bug nobody would connect to a cube.
    const controls = mount(true)
    const input = document.createElement('input')
    document.body.appendChild(input)

    press('a', input)
    expect(controls().camera.face).toBe('home')
  })

  it('leaves browser and OS shortcuts alone', () => {
    const controls = mount(true)

    act(() => {
      window.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, bubbles: true }),
      )
    })

    expect(controls().camera.face).toBe('home')
  })

  it('refuses keys while locked', () => {
    const controls = mount(true)

    act(() => controls().toggleLock())
    press('ArrowUp')

    expect(controls().camera).toEqual({ face: 'home', locked: true })
  })

  it('listens to nothing when it is not active', () => {
    const controls = mount(false)

    press('ArrowUp')
    expect(controls().camera.face).toBe('home')
  })

  it('has no way to reach game state or the wire', () => {
    // The spec asks that the padlock be provable to change presentation only.
    // The proof is structural rather than behavioural: the hook takes one
    // boolean and returns four things, none of which is a command, a packet, a
    // seat, or a board. There is no channel for it to affect a match through.
    const controls = mount(true)

    expect(Object.keys(controls()).sort()).toEqual(['camera', 'jump', 'move', 'toggleLock'])
    expect(Object.keys(controls().camera).sort()).toEqual(['face', 'locked'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=hidden-web -- useFaceCamera`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/hooks/useFaceCamera.ts`**

```ts
import { useCallback, useEffect, useState } from 'react'
import {
  INITIAL_FACE_CAMERA,
  directionForKey,
  jumpCamera,
  moveCamera,
  toggleCameraLock,
  type FaceCamera,
} from '../game/faceNavigation'
import type { CubeFace, FaceDirection } from '@hidden/game-core'

export interface FaceCameraControls {
  readonly camera: FaceCamera
  readonly move: (direction: FaceDirection) => void
  readonly jump: (face: CubeFace) => void
  readonly toggleLock: () => void
}

/*
 * The listener is on `window` rather than on the board, because the player
 * should not have to click a cell before the arrow keys work. That reach is also
 * why it has to stand down for anything being typed into.
 */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/**
 * Which face this player is looking at, for as long as a cube match is on screen.
 *
 * `active` is both the switch for the keyboard listener and the reset: coming
 * back into a match — including through AGAIN? — puts the camera on `home` with
 * navigation open, which is where Phase 1 says every match begins.
 */
export function useFaceCamera(active: boolean): FaceCameraControls {
  const [camera, setCamera] = useState<FaceCamera>(INITIAL_FACE_CAMERA)

  useEffect(() => {
    if (!active) return
    setCamera(INITIAL_FACE_CAMERA)
  }, [active])

  const move = useCallback((direction: FaceDirection) => {
    setCamera((current) => moveCamera(current, direction))
  }, [])

  const jump = useCallback((face: CubeFace) => {
    setCamera((current) => jumpCamera(current, face))
  }, [])

  const toggleLock = useCallback(() => {
    setCamera(toggleCameraLock)
  }, [])

  useEffect(() => {
    if (!active) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const direction = directionForKey(event.key)
      if (!direction) return

      // Claimed even while locked. The arrow keys belong to the board for the
      // length of a cube match, and a locked arrow that scrolled the page
      // instead would read as the key not being bound at all.
      event.preventDefault()
      move(direction)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, move])

  return { camera, move, jump, toggleLock }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace=hidden-web -- useFaceCamera`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useFaceCamera.ts web/src/hooks/__tests__/useFaceCamera.test.ts
git commit -m "feat(web): own the cube camera and its keyboard in one hook

Arrow keys and WASD are equivalent, both stand down for anything being
typed into, and both are claimed even while locked so a dead key never
reads as an unbound one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Put a face on the battle screen

The wiring task. It also fixes the one measurement the arrow frame breaks.

**Files:**
- Modify: `web/src/hooks/useBoardSideVar.ts`
- Modify: `web/src/App.tsx`
- Test: `web/src/hooks/__tests__/useBoardSideVar.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces: `useBoardSideVar.ts` additionally exports `const PLAYED_BOARD_GRID_SELECTOR: string`.

- [ ] **Step 1: Write the failing selector test**

`useBoardSideVar` finds the played board with `:scope > .hidden-board > .hidden-board-grid`. Task 5 puts `.face-frame` between those last two, so the selector stops matching, `--board-side` is never published, and the board's caption and the opponent peek lose their alignment — which on iOS is the bug the hook exists to prevent.

Create `web/src/hooks/__tests__/useBoardSideVar.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { PLAYED_BOARD_GRID_SELECTOR } from '../useBoardSideVar'

function arena(playedBoardInner: string) {
  const element = document.createElement('div')
  element.className = 'battle-arena'
  element.innerHTML = `
    <section class="hidden-board">
      <header class="hidden-board-header"></header>
      ${playedBoardInner}
    </section>
    <aside class="opponent-peek">
      <section class="hidden-board">
        <div class="hidden-board-grid" data-board="peek"></div>
      </section>
    </aside>
  `
  return element
}

describe('the played board selector', () => {
  it('finds an unframed board', () => {
    const found = arena(
      '<div class="hidden-board-grid" data-board="played"></div>',
    ).querySelector(PLAYED_BOARD_GRID_SELECTOR)

    expect(found?.getAttribute('data-board')).toBe('played')
  })

  it('finds a board framed by the face arrows', () => {
    const found = arena(
      '<div class="face-frame"><div class="hidden-board-grid" data-board="played"></div></div>',
    ).querySelector(PLAYED_BOARD_GRID_SELECTOR)

    expect(found?.getAttribute('data-board')).toBe('played')
  })

  it('never picks the opponent peek', () => {
    // The peek and the reveal snapshot are siblings of the played board, not
    // descendants of it. That is the whole reason the selector can afford to
    // stop being a direct-child chain.
    expect(arena('').querySelector(PLAYED_BOARD_GRID_SELECTOR)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=hidden-web -- useBoardSideVar`
Expected: FAIL — `PLAYED_BOARD_GRID_SELECTOR` is not exported.

- [ ] **Step 3: Implement**

In `web/src/hooks/useBoardSideVar.ts`, add above the hook:

```ts
/**
 * The played board's grid, and nothing else in the arena.
 *
 * A descendant chain rather than a direct-child one, because the cube's face
 * arrows frame the grid and would otherwise break the measurement — and with it
 * the caption alignment this hook exists to provide. It stays unambiguous: the
 * opponent peek and the reveal snapshot are siblings of the played board, not
 * descendants of it, so neither can be matched here.
 */
export const PLAYED_BOARD_GRID_SELECTOR = ':scope > .hidden-board .hidden-board-grid'
```

and use it inside `publish`:

```ts
      const grid = arena.querySelector(PLAYED_BOARD_GRID_SELECTOR)
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace=hidden-web -- useBoardSideVar`
Expected: PASS.

- [ ] **Step 5: Wire the battle screen in `App.tsx`**

Add the imports:

```ts
import { firstLocationOfFace } from '@hidden/game-core'
import { CubeMap } from './components/CubeMap'
import { FaceArrows } from './components/FaceArrows'
import { faceCellCounts, faceCells } from './game/faceNavigation'
import { useFaceCamera } from './hooks/useFaceCamera'
```

Next to the existing hook calls:

```ts
  // `isPrototypeMatch` is the only thing that turns any of the cube on. `main`
  // renders exactly as it did before, down to the unframed board.
  const isCubeMatch = isPrototypeMatch(match)
  const faceCamera = useFaceCamera(screen === 'battle' && isCubeMatch)
  const activeFace = faceCamera.camera.face
  const faceOffset = isCubeMatch ? firstLocationOfFace(activeFace) : 0
```

Replace the battle-screen player `BoardGrid` with the following. `match` is already narrowed to non-null inside this branch, so the slices are computed inline rather than hoisted:

```tsx
              <BoardGrid
                // Remounts on a face change. `useCellInk` treats a prop change
                // as ink arriving and a mount as ink already down, so without
                // this key every piece on the face you walk onto would replay
                // its fill as though it had just been placed.
                key={isCubeMatch ? activeFace : 'played'}
                title="Player Board"
                subtitle={username.trim() || 'Player'}
                grid={isCubeMatch ? faceCells(match.playerGrid, activeFace) : match.playerGrid}
                columns={match.config.boardSize}
                indexOffset={faceOffset}
                navigation={
                  isCubeMatch ? (
                    <FaceArrows
                      face={activeFace}
                      locked={faceCamera.camera.locked}
                      onMove={faceCamera.move}
                    />
                  ) : undefined
                }
                interactive={
                  match.isMyTurn &&
                  (!match.config.isOnline || !onlineInputPending)
                }
                selectedSymbol={match.selectedSymbol}
                destructionEffects={playerDestructionEffects}
                onSelect={onCellSelect}
              />
```

The opponent peek's `BoardGrid` and the `RevealSnapshot` both take:

```tsx
                grid={isCubeMatch ? faceCells(match.opponentGrid, activeFace) : match.opponentGrid}
                columns={match.config.boardSize}
                indexOffset={faceOffset}
```

In `.battle-controls`, immediately above the `PowerupTray`:

```tsx
              {isCubeMatch ? (
                <CubeMap
                  face={activeFace}
                  locked={faceCamera.camera.locked}
                  cellCounts={faceCellCounts(match.playerGrid)}
                  onJump={faceCamera.jump}
                  onToggleLock={faceCamera.toggleLock}
                />
              ) : null}
```

- [ ] **Step 6: Verify the package**

```bash
npm test --workspace=hidden-web && npm run lint --workspace=hidden-web && npm run build --workspace=hidden-web
```

Expected: all PASS.

- [ ] **Step 7: Look at it**

Start the two-process dev setup from `docs/ROADMAP.md` → "Local development":

```bash
npm run build --workspace=hidden-server && npm start --workspace=hidden-server
```

then `npm run dev --workspace=hidden-web` in a second shell, and open a practice match with `PROTOTYPE` selected. Confirm in the browser:

- Four braces around the board, dark grey, brightening and nudging outward on hover.
- Arrow keys, WASD, and clicking a brace all move to the same face.
- The map marks the current face, and its counts go up as you place.
- The padlock turns the braces and the map tiles translucent, kills the keys, and turns red reading `LOCKED`. Pressing it again restores all three.
- Walking onto a face that already has pieces on it does **not** replay their ink fill.
- The board caption stays exactly as wide as the board.
- At a 375px viewport the board, arrows, map, tray, and move tiles all fit, and the page does not scroll sideways.

Fix anything wrong before committing. This is the task where the layout either works or does not.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "feat(web): play the cube one face at a time

Braces around the board, the unfolded map in the controls column, and
the padlock wired to all three input paths. The played-board measuring
selector loses its direct-child chain because the arrow frame sits in
it; the peek and the snapshot are siblings, so it stays unambiguous.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The whole cube on the result screen

The result boards render every cell a player holds. With 54 cells the old renderer drew a seven-column rectangle; now it draws the net. This is a score audit, so all six faces are shown at once rather than navigated.

**Files:**
- Create: `web/src/components/CubeNet.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/prototype-mode.css`
- Test: `web/src/components/__tests__/CubeNet.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces: `function CubeNet(props: { subtitle: string; grid: GridState; scoreCountLabels?: Partial<Record<number, number>>; destructionEffects?: Partial<Record<number, CellDestructionEffect>> })`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/CubeNet.test.ts`:

```ts
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CubeNet } from '../CubeNet'
import type { GridState } from '../../game/types'

const grid: GridState = {
  cells: Array.from({ length: 54 }, (_, index) => ({
    occupied: index === 53,
    symbol: index === 53 ? ('paper' as const) : null,
    immune: false,
    desecrated: false,
  })),
}

describe('the result net', () => {
  it('draws six three-column faces', () => {
    const markup = renderToStaticMarkup(
      createElement(CubeNet, { subtitle: 'Player', grid }),
    )

    expect(markup.match(/--board-size:3/g)).toHaveLength(6)
    expect(markup).not.toContain('--board-size:7')
  })

  it('keeps true location ids across the net', () => {
    const markup = renderToStaticMarkup(
      createElement(CubeNet, { subtitle: 'Player', grid, scoreCountLabels: { 53: 1 } }),
    )

    expect(markup).toContain('aria-label="Cell 54, Point 1"')
  })

  it('names every face', () => {
    const markup = renderToStaticMarkup(
      createElement(CubeNet, { subtitle: 'Player', grid }),
    )

    for (const label of ['HOME', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'BACK']) {
      expect(markup).toContain(label)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=hidden-web -- CubeNet`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/CubeNet.tsx`**

```tsx
import '../prototype-mode.css'
import { firstLocationOfFace } from '@hidden/game-core'
import { BoardGrid, type CellDestructionEffect } from './BoardGrid'
import { CROSS_LAYOUT, FACE_LABELS, faceCells } from '../game/faceNavigation'
import type { GridState } from '../game/types'

interface CubeNetProps {
  subtitle: string
  grid: GridState
  scoreCountLabels?: Partial<Record<number, number>>
  destructionEffects?: Partial<Record<number, CellDestructionEffect>>
}

/**
 * All six faces at once, in the same cross the map uses.
 *
 * The result screen is a score audit, so one face at a time would be the wrong
 * shape — a player counting their cells should not have to navigate. The cross
 * rather than a 3x2 block because the in-match map already taught this
 * arrangement, and a second one would be a second thing to learn for no gain.
 */
export function CubeNet({
  subtitle,
  grid,
  scoreCountLabels = {},
  destructionEffects = {},
}: CubeNetProps) {
  return (
    <section className="cube-net" aria-label={`${subtitle}: cube`}>
      {CROSS_LAYOUT.map((face, index) =>
        face === null ? (
          <span key={index} className="cube-net-blank" aria-hidden="true" />
        ) : (
          <BoardGrid
            key={index}
            title=""
            subtitle={FACE_LABELS[face]}
            grid={faceCells(grid, face)}
            columns={3}
            indexOffset={firstLocationOfFace(face)}
            compact
            showDesecration={false}
            scoreCountLabels={scoreCountLabels}
            destructionEffects={destructionEffects}
          />
        ),
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace=hidden-web -- CubeNet`
Expected: PASS.

- [ ] **Step 5: Add the net CSS**

Append to `web/src/prototype-mode.css`:

```css
.cube-net {
  --net-face: clamp(3.4rem, 17vw, 5.25rem);
  display: grid;
  grid-template-columns: repeat(3, var(--net-face));
  gap: 0.45rem;
  justify-content: center;
}

.cube-net-blank {
  display: block;
}

/* The face name is the only label a net tile needs, and six brush-set player
 * names stacked down a column would be six copies of the same word. */
.cube-net .hidden-board {
  gap: 0.2rem;
}

.cube-net .hidden-board-header {
  min-height: 0;
}

.cube-net .hidden-board-header h3 {
  color: var(--hidden-muted);
  font-family: var(--font-block);
  font-size: 0.45rem;
  letter-spacing: 0.1em;
  text-shadow: none;
}

/* Two nets do not fit side by side on a phone, and being able to read the audit
 * is worth more than being able to compare the two at a glance. */
@media (max-width: 900px) {
  .final-boards-net {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 6: Use it on the result screen**

Import `CubeNet` in `App.tsx`, then replace the `.final-boards` block with:

```tsx
          <div className={`final-boards ${isCubeMatch ? 'final-boards-net' : ''}`}>
            {isCubeMatch ? (
              <>
                <CubeNet
                  subtitle={username.trim() || 'Player'}
                  grid={match.playerGrid}
                  scoreCountLabels={playerScoreCountLabels}
                  destructionEffects={playerDestructionEffects}
                />
                <CubeNet
                  subtitle={opponentName}
                  grid={match.opponentGrid}
                  scoreCountLabels={opponentScoreCountLabels}
                />
              </>
            ) : (
              <>
                <BoardGrid
                  title=""
                  subtitle={username.trim() || 'Player'}
                  grid={match.playerGrid}
                  columns={match.config.boardSize}
                  showDesecration={false}
                  destructionEffects={playerDestructionEffects}
                  scoreCountLabels={playerScoreCountLabels}
                />
                <BoardGrid
                  title=""
                  subtitle={opponentName}
                  grid={match.opponentGrid}
                  columns={match.config.boardSize}
                  showDesecration={false}
                  scoreCountLabels={opponentScoreCountLabels}
                />
              </>
            )}
          </div>
```

- [ ] **Step 7: Verify, then look at a finished match**

```bash
npm test --workspace=hidden-web && npm run lint --workspace=hidden-web && npm run build --workspace=hidden-web
```

Then play a practice prototype match to its end with `turnSeconds` at its minimum so it resolves in seconds. Confirm both nets render, the `TBD` headline and the debug cell counts are still there, and that at 375px the page does not scroll sideways.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "feat(web): show the finished cube as its unfolded net

The result screen is a score audit, so all six faces are laid out at
once rather than navigated. Same cross the in-match map uses, because a
second arrangement would be a second thing to learn.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Verify everything, and write down what the phase left open

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/JOURNAL.md`

- [ ] **Step 1: Run every check in the repository**

```bash
npm test --workspace=@hidden/game-core
npm run build --workspace=@hidden/game-core
npm test --workspace=hidden-server
npm run build --workspace=hidden-server
npm test --workspace=hidden-web
npm run lint --workspace=hidden-web
npm run build --workspace=hidden-web
```

Expected: all PASS. Record the real output; do not summarise a run that was not made.

- [ ] **Step 2: Play a two-tab online prototype match**

Per `docs/ROADMAP.md` → "Local development": build and start the server, run the web dev server, open two tabs, play a `prototype` quick match to its end.

Confirm:
- Both tabs can be on **different faces at the same time**, and neither moves when the other does.
- One tab's padlock does not touch the other's.
- A placement made on face `back` in one tab lands on the right cell, and the opponent's board reflects it on that face.
- The 12-round match finishes and reports `TBD`.
- Nothing prototype-shaped appears in the history screen, and the server logs no match-record write for it.

- [ ] **Step 3: Confirm `main` did not move**

Play one offline `MAIN` match. The board, the caption width, the hand-cut cell edges, the ink fills, the result screen, and the score walk must be exactly as before — no braces, no map, no net.

- [ ] **Step 4: Verify the production container**

Local Docker is broken on this machine; build and boot the production image on the Hetzner box instead. Confirm `GET /healthz` answers and that the served `/assets/index-*.js` hash is the new one.

- [ ] **Step 5: Update the roadmap**

In `docs/ROADMAP.md`, mark Phase 1 `Done 2026-09-12` in the phase table, and update the "Active work" prose to say the cube is open and navigable and that Phase 2 promotes the padlock from a debug switch to a rule.

Add, in the roadmap's own voice, the three things this phase leaves open:

- The reveal power-up now shows one face out of six, which makes it much weaker in the prototype. Decide in Phase 2 or 3 whether reveal should show the whole net, the face the opponent is standing on, or stay as it is.
- Navigation is free, so expansion is free. Fine for "does it feel like anything", certainly wrong for balance.
- 12 rounds across 54 cells is a starting guess. If a match runs long, lower `turnSeconds` for the variant rather than raising `rounds`.

- [ ] **Step 6: Journal the phase**

Add a `docs/JOURNAL.md` entry dated 2026-09-12 covering what shipped, and the three things worth knowing next time:

- `node --test` will not resolve an extensionless relative import in this package, which is why the sources import each other as `./config.ts` and `tsconfig.json` carries `rewriteRelativeImportExtensions`.
- `useCellInk` treats a prop change as ink arriving and a mount as ink already down, so the played board is keyed on the active face. Without the key, walking onto an occupied face replays every fill at once.
- `useBoardSideVar`'s selector was a direct-child chain and the arrow frame sits inside it. The peek and the reveal snapshot are siblings of the played board rather than descendants, which is what made loosening it safe.

- [ ] **Step 7: Commit and open the pull request**

```bash
git add docs
git commit -m "docs: mark cube prototype phase 1 complete

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin cube-prototype-phase-1
```

Open the PR with `gh pr create`, ending the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

**Do not deploy.** Merging to `main` does not release: the push webhook answers 200 and queues nothing. Production delivery is an explicit manual release and a separate decision from merging this.

---

## Notes for whoever executes this

**`packages/game-core` runs `node:test`, not Vitest.** It is the only package that does. Its tests use `assert.equal` / `assert.deepEqual` and import with the `.ts` extension.

**Vitest's default environment here is `node`.** A test that needs a DOM opens with `/** @vitest-environment jsdom */` on line 1. Tasks 7 and 8 need it; every other web test in this plan renders with `renderToStaticMarkup` and does not.

**`index` and `locationId` are the same number everywhere outside `BoardGrid`.** `useMatchSession.selectCell`, `useDestructionEffects`, and `getScoreCountLabels` all speak absolute location IDs. `indexOffset` exists so that stays true when the renderer is only shown nine of fifty-four cells — do not push the offset out into those call sites.

**The prototype is never written to match history, and that is already true.** `matchCoordinator.ts` returns early from `onMatchCompleted` for any variant other than `main`, which is what keeps `createMatchHistoryRecord`'s `columns: config.boardSize` from recording a 54-cell board as three columns. Do not remove that gate to "fix" the column count.

**Quick match already segregates on variant,** and config resolution is already `defaultConfigForVariant(proposedConfig.variant)` for non-admins. Nothing in this phase touches matchmaking.

**`rounds: 12` for the prototype landed in Phase 0** via `PROTOTYPE_ROUNDS`. There is nothing to do for it here.

**The offline bot needs no change.** It is `applyTimeout`, which draws uniformly from the engine's playable-location set, so it extends to 54 cells on its own. It will scatter across all six faces, which reads as random. Acceptable for this phase.

## What Phase 1 deliberately does not do

Do not start any of these.

- No `unlockedFaces` in `GameState`, no corner-pair trigger, no shared unlock. That is Phase 2, and the padlock is deliberately a client switch so Phase 2 has nothing to dismantle first.
- No new `RejectionReason`. Every one of the 54 locations is legal in this phase.
- No seam rotation, and no winning pattern that crosses a face boundary.
- No re-orientable net. The cross is fixed.
- No 3D cube rendering.
- No face-aware bot.
- No opponent activity on the map. The counts are the player's own cells only.
- No balance work, no win condition, no `ENGINE_REVISION` bump.
