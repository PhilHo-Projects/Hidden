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
