import { CUBE_FACES, type CubeFace, type FaceDirection } from '@hidden/game-core'

/*
 * Which way round the cube is, for the 3D view.
 *
 * An orientation is a rotation matrix whose entries are all -1, 0 or 1, read
 * row-major. Column j is where the cube's own axis j points on screen, in a
 * frame where +X is right, +Y is up and +Z comes out of the screen toward the
 * player. There are exactly 24 such matrices, and keeping them as integers means
 * equality is exact and no number of turns can drift.
 *
 * Presentation state, like `FaceCamera`: it never enters `GameState` and never
 * crosses the wire. It is also a different model from the flat view's. The flat
 * view always draws a face in the frame `CUBE_ADJACENCY` assumes; a real cube
 * can arrive on a face rolled, so here "north" means up the screen.
 */

export type Vec3 = readonly [number, number, number]

export type Orientation = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

/**
 * A quarter turn about a screen axis, bringing that side's face to the front.
 *
 * Only the four directions. Rolling the cube in place about Z was offered as a
 * pair of buttons and removed: it let a player straighten a face by hand, which
 * turned the one thing this view exists to test -- that a face can arrive
 * rolled -- into a chore to undo.
 */
export type CubeMove = FaceDirection

/** Degrees clockwise, the way CSS `rotate` reads an angle. */
export type Roll = 0 | 90 | 180 | 270

export const IDENTITY: Orientation = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * Each face's outward normal and its own north, in the cube's frame: the frames
 * `CUBE_ADJACENCY` is derived from, and the ones `build_cube.py` lays tiles in.
 */
export const FACE_NORMALS: Readonly<Record<CubeFace, Vec3>> = {
  home: [0, 0, 1],
  up: [0, 1, 0],
  down: [0, -1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  back: [0, 0, -1],
}

export const FACE_NORTHS: Readonly<Record<CubeFace, Vec3>> = {
  home: [0, 1, 0],
  up: [0, 0, -1],
  down: [0, 0, 1],
  left: [0, 1, 0],
  right: [0, 1, 0],
  back: [0, 1, 0],
}

const MOVE_MATRICES: Readonly<Record<CubeMove, Orientation>> = {
  north: [1, 0, 0, 0, 0, -1, 0, 1, 0], // +90° about X: the top face comes forward
  south: [1, 0, 0, 0, 0, 1, 0, -1, 0], // -90° about X
  east: [0, 0, -1, 0, 1, 0, 1, 0, 0], // -90° about Y: the right face comes forward
  west: [0, 0, 1, 0, 1, 0, -1, 0, 0], // +90° about Y
}

export const CUBE_MOVES: readonly CubeMove[] = ['north', 'east', 'south', 'west']

export const INVERSE_MOVE: Readonly<Record<CubeMove, CubeMove>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
}

// `+ 0` turns a -0 into 0, so `toEqual` and `===` never disagree.
function multiply(a: Orientation, b: Orientation): Orientation {
  const out: number[] = []
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out.push(a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col] + 0)
    }
  }
  return out as unknown as Orientation
}

export function rotate(o: Orientation, v: Vec3): Vec3 {
  return [
    o[0] * v[0] + o[1] * v[1] + o[2] * v[2] + 0,
    o[3] * v[0] + o[4] * v[1] + o[5] * v[2] + 0,
    o[6] * v[0] + o[7] * v[1] + o[8] * v[2] + 0,
  ]
}

const sameVec = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

export function sameOrientation(a: Orientation, b: Orientation): boolean {
  return a.every((entry, index) => entry === b[index])
}

/** Premultiplied: the move is about the screen's axis, not the cube's. */
export function turn(o: Orientation, move: CubeMove): Orientation {
  return multiply(MOVE_MATRICES[move], o)
}

const SCREEN_FRONT: Vec3 = [0, 0, 1]
const SCREEN_DIRECTIONS: Readonly<Record<FaceDirection, Vec3>> = {
  north: [0, 1, 0],
  east: [1, 0, 0],
  south: [0, -1, 0],
  west: [-1, 0, 0],
}

/** The face pointing along `screen`. Every orientation puts exactly one face on each axis. */
export function faceAt(o: Orientation, screen: Vec3): CubeFace {
  const face = CUBE_FACES.find((candidate) => sameVec(rotate(o, FACE_NORMALS[candidate]), screen))
  if (!face) throw new Error(`No face points along ${screen.join(',')}; not an orientation`)
  return face
}

export const frontFace = (o: Orientation): CubeFace => faceAt(o, SCREEN_FRONT)
export const topFace = (o: Orientation): CubeFace => faceAt(o, SCREEN_DIRECTIONS.north)

/**
 * Which face lies each way *on screen*. On a rolled face this is not
 * `CUBE_ADJACENCY[front]`, which is why `FaceArrows` takes it as a prop.
 */
export function screenNeighbours(o: Orientation): Record<FaceDirection, CubeFace> {
  return {
    north: faceAt(o, SCREEN_DIRECTIONS.north),
    east: faceAt(o, SCREEN_DIRECTIONS.east),
    south: faceAt(o, SCREEN_DIRECTIONS.south),
    west: faceAt(o, SCREEN_DIRECTIONS.west),
  }
}

/**
 * How far the front face is turned from its own upright, clockwise. 0 means it
 * is drawn exactly as the flat view draws it.
 */
export function rollDegrees(o: Orientation): Roll {
  const north = rotate(o, FACE_NORTHS[frontFace(o)])
  if (north[1] === 1) return 0
  if (north[0] === 1) return 90
  if (north[1] === -1) return 180
  return 270
}

// Rolls never change the front face, so they are no use for a jump.
const JUMP_MOVES: readonly CubeMove[] = ['east', 'west', 'north', 'south']

/**
 * The orientation that puts `face` in front with the least turning: none if it
 * already is, one quarter turn for a neighbour, and a half turn about the
 * vertical for the opposite face. Breadth-first in a fixed move order, so the
 * answer is deterministic. Returns `o` itself when nothing moves, so a React
 * state setter bails out.
 */
export function jumpTo(o: Orientation, face: CubeFace): Orientation {
  if (frontFace(o) === face) return o
  let frontier: Orientation[] = [o]
  for (let depth = 0; depth < 2; depth += 1) {
    const next: Orientation[] = []
    for (const current of frontier) {
      for (const move of JUMP_MOVES) {
        const candidate = turn(current, move)
        if (frontFace(candidate) === face) return candidate
        next.push(candidate)
      }
    }
    frontier = next
  }
  throw new Error(`No way to bring ${face} to the front`)
}
