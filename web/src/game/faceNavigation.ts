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

/**
 * Words rather than initials. A map tile has room for four characters, and a
 * player reading `B` on a cube that has both `back` and `blind mode` has been
 * given a puzzle instead of a label.
 */
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
