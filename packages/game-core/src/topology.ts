import { deepFreeze, type BoardSize, type GameConfig, type LocationId } from './config.ts'

/**
 * What a board *is*: the set of playable location IDs, and the lines that
 * unlock a power-up when one is completed.
 *
 * The only module in the package that knows a board has a shape. Every reducer
 * function in `index.ts` operates on opaque IDs and on `winningPatterns`, which
 * is data — which is why a cube needs a builder here and nothing else.
 */

export interface ClassicTopology {
  readonly locationIds: readonly LocationId[]
  readonly winningPatterns: readonly (readonly LocationId[])[]
}

// Pattern order is load-bearing: `maybeUnlockPowerup` returns on the first
// match, so reordering changes which power-up unlocks when two lines complete
// on the same turn. The 3x3 output is asserted against the legacy order.
export function createTopology(
  boardSize: BoardSize,
  streak: number,
): ClassicTopology {
  if (!Number.isInteger(streak) || streak < 2 || streak > boardSize) {
    throw new Error(
      `Invalid streak ${streak} for a ${boardSize}x${boardSize} board.`,
    )
  }

  const locationIds: LocationId[] = []
  for (let index = 0; index < boardSize * boardSize; index += 1) {
    locationIds.push(index)
  }

  const at = (row: number, column: number) => row * boardSize + column
  const offsets: number[] = []
  for (let step = 0; step < streak; step += 1) offsets.push(step)
  const windows = boardSize - streak + 1
  const winningPatterns: LocationId[][] = []

  for (let row = 0; row < boardSize; row += 1) {
    for (let column = 0; column < windows; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row, column + step)))
    }
  }
  for (let column = 0; column < boardSize; column += 1) {
    for (let row = 0; row < windows; row += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column)))
    }
  }
  for (let row = 0; row < windows; row += 1) {
    for (let column = 0; column < windows; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column + step)))
    }
  }
  for (let row = 0; row < windows; row += 1) {
    for (let column = streak - 1; column < boardSize; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column - step)))
    }
  }

  return deepFreeze({ locationIds, winningPatterns })
}

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
 * Seam rotation -- how a cell index on one face's edge maps onto its
 * neighbour's -- is deliberately not recorded, because no winning pattern
 * crosses a seam in any planned phase. If cross-face lines are ever wanted,
 * this is the table to extend rather than the geometry to re-derive.
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
