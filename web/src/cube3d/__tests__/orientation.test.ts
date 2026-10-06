import { CUBE_FACES, neighbourFace, type FaceDirection } from '@hidden/game-core'
import { describe, expect, it } from 'vitest'
import {
  CUBE_MOVES,
  IDENTITY,
  INVERSE_MOVE,
  frontFace,
  jumpTo,
  rollDegrees,
  sameOrientation,
  screenNeighbours,
  topFace,
  turn,
  type Orientation,
} from '../orientation'

const DIRECTIONS: readonly FaceDirection[] = ['north', 'east', 'south', 'west']

function everyOrientation(): Orientation[] {
  const seen = new Map<string, Orientation>([[IDENTITY.join(), IDENTITY]])
  const queue: Orientation[] = [IDENTITY]
  while (queue.length > 0) {
    const current = queue.shift() as Orientation
    for (const move of CUBE_MOVES) {
      const next = turn(current, move)
      if (!seen.has(next.join())) {
        seen.set(next.join(), next)
        queue.push(next)
      }
    }
  }
  return [...seen.values()]
}

describe('cube orientation', () => {
  it('has exactly the 24 rotations of a cube', () => {
    expect(everyOrientation()).toHaveLength(24)
  })

  it('keeps every entry an exact integer, with no negative zero', () => {
    // Integers are the point: equality stays exact however many turns are
    // taken. A -0 would also make `toEqual` disagree with `===`.
    for (const orientation of everyOrientation()) {
      for (const entry of orientation) {
        expect([-1, 0, 1]).toContain(entry)
        expect(Object.is(entry, -0)).toBe(false)
      }
    }
  })

  it('puts a different face on every screen axis', () => {
    for (const orientation of everyOrientation()) {
      const faces = new Set([frontFace(orientation), ...Object.values(screenNeighbours(orientation))])
      expect(faces.size).toBe(5)
    }
  })

  it('undoes every move with its inverse', () => {
    for (const orientation of everyOrientation()) {
      for (const move of CUBE_MOVES) {
        expect(sameOrientation(turn(turn(orientation, move), INVERSE_MOVE[move]), orientation)).toBe(true)
      }
    }
  })

  it('comes back round after four of the same move', () => {
    for (const move of CUBE_MOVES) {
      let orientation = IDENTITY
      for (let i = 0; i < 4; i += 1) orientation = turn(orientation, move)
      expect(sameOrientation(orientation, IDENTITY)).toBe(true)
    }
  })

  it('brings the face on that side of the screen to the front', () => {
    expect(frontFace(IDENTITY)).toBe('home')
    expect(topFace(IDENTITY)).toBe('up')
    expect(frontFace(turn(IDENTITY, 'north'))).toBe('up')
    expect(frontFace(turn(IDENTITY, 'south'))).toBe('down')
    expect(frontFace(turn(IDENTITY, 'east'))).toBe('right')
    expect(frontFace(turn(IDENTITY, 'west'))).toBe('left')
  })

  it('arrives on a face rolled, the way a real cube does', () => {
    // Right, then up. The flat view would show `up` with `back` on top; a real
    // cube shows it turned a quarter with `left` on top.
    const orientation = turn(turn(IDENTITY, 'east'), 'north')
    expect(frontFace(orientation)).toBe('up')
    expect(topFace(orientation)).toBe('left')
    expect(rollDegrees(orientation)).toBe(90)
  })

  it('reads a roll clockwise, the way CSS rotate does', () => {
    expect(rollDegrees(IDENTITY)).toBe(0)
    expect(rollDegrees(turn(turn(IDENTITY, 'east'), 'north'))).toBe(90)
  })

  /*
   * The roll buttons are gone, so this is what guarantees nothing went with
   * them: all 24 orientations are still reachable from the four directions
   * alone. A player who lands on a face turned the wrong way can still
   * straighten it -- by walking a loop, which is a move in the game, rather
   * than by pressing a button that only exists to undo the geometry.
   */
  it('reaches every orientation of the cube from the four directions', () => {
    const seen = new Map<string, Orientation>([[IDENTITY.join(), IDENTITY]])
    const queue: Orientation[] = [IDENTITY]

    while (queue.length > 0) {
      const current = queue.shift() as Orientation
      for (const move of CUBE_MOVES) {
        const next = turn(current, move)
        const key = next.join()
        if (seen.has(key)) continue
        seen.set(key, next)
        queue.push(next)
      }
    }

    expect(seen.size).toBe(24)
    for (const orientation of seen.values()) {
      expect([0, 90, 180, 270]).toContain(rollDegrees(orientation))
    }
  })

  it('has exactly one upright orientation per face', () => {
    const upright = everyOrientation().filter((orientation) => rollDegrees(orientation) === 0)
    expect(upright.map(frontFace).sort()).toEqual([...CUBE_FACES].sort())
  })

  it('agrees with the flat view whenever the face is upright', () => {
    for (const orientation of everyOrientation()) {
      if (rollDegrees(orientation) !== 0) continue
      const front = frontFace(orientation)
      for (const direction of DIRECTIONS) {
        expect(screenNeighbours(orientation)[direction]).toBe(neighbourFace(front, direction))
      }
    }
  })

  it('does nothing when asked to jump to the face already in front', () => {
    expect(jumpTo(IDENTITY, 'home')).toBe(IDENTITY)
  })

  it('jumps to a neighbour with exactly one quarter turn', () => {
    for (const orientation of everyOrientation()) {
      for (const direction of DIRECTIONS) {
        const neighbour = screenNeighbours(orientation)[direction]
        expect(sameOrientation(jumpTo(orientation, neighbour), turn(orientation, direction))).toBe(true)
      }
    }
  })

  it('jumps to the opposite face with a half turn about the vertical', () => {
    expect(sameOrientation(jumpTo(IDENTITY, 'back'), turn(turn(IDENTITY, 'east'), 'east'))).toBe(true)
  })

  it('can bring any face to the front from anywhere', () => {
    for (const orientation of everyOrientation()) {
      for (const face of CUBE_FACES) {
        expect(frontFace(jumpTo(orientation, face))).toBe(face)
      }
    }
  })
})
