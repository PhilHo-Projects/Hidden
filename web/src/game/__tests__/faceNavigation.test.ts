import { CUBE_FACES, neighbourFace, type FaceDirection } from '@hidden/game-core'
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
import type { FaceCamera } from '../faceNavigation'
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
