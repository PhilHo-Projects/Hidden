import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CUBE_FACES, faceIndex, type CubeFace } from '@hidden/game-core'
import { describe, expect, it } from 'vitest'
import { FACE_NORMALS, FACE_NORTHS, type Vec3 } from '../src/cube3d/orientation'

/*
 * The scene trusts three things about the Blender export, and this pins all of
 * them: a mesh named `body`; 54 tiles whose extras name their face, cell and
 * location; and each tile sitting on its own face in that face's frame. A
 * re-export that breaks any of them fails here instead of misplacing pieces.
 */

interface GltfNode {
  name?: string
  translation?: [number, number, number]
  extras?: Record<string, unknown>
  children?: number[]
}

function readGltf(): { nodes: GltfNode[] } {
  const bytes = readFileSync(
    fileURLToPath(new URL('../src/assets/models/cube.glb', import.meta.url)),
  )
  // 12-byte header, then the JSON chunk's length and type, then the JSON.
  expect(bytes.toString('latin1', 0, 4)).toBe('glTF')
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a)
  return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
}

const dot = (a: Vec3, b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
/** -1, 0 or 1 for which third of the face a coordinate falls in. `+ 0` folds away a -0. */
const side = (value: number) => Math.sign(Math.round(value * 100)) + 0

describe('the cube model', () => {
  const { nodes } = readGltf()
  const tiles = nodes.filter((node) => typeof node.extras?.face === 'string')

  it('has one body carrying all 54 tiles', () => {
    const body = nodes.find((node) => node.name === 'body')
    expect(body?.extras?.role).toBe('body')
    expect(body?.children).toHaveLength(54)
    expect(tiles).toHaveLength(54)
  })

  it('numbers every tile the way the engine numbers locations', () => {
    const locations = tiles.map((tile) => {
      const face = tile.extras?.face as CubeFace
      const cell = tile.extras?.cell as number
      expect(CUBE_FACES).toContain(face)
      expect(tile.extras?.location).toBe(faceIndex(face) * 9 + cell)
      return tile.extras?.location
    })
    expect(new Set(locations).size).toBe(54)
  })

  it("sits each tile on its own face, cell 0 top-left in that face's frame", () => {
    for (const tile of tiles) {
      const face = tile.extras?.face as CubeFace
      const cell = tile.extras?.cell as number
      const position = tile.translation ?? [0, 0, 0]
      const normal = FACE_NORMALS[face]
      const north = FACE_NORTHS[face]
      const east = cross(north, normal)
      const row = Math.floor(cell / 3)
      const col = cell % 3

      expect(dot(normal, position)).toBeGreaterThan(0.9)
      expect(side(dot(east, position))).toBe(col - 1)
      expect(side(dot(north, position))).toBe(1 - row)
    }
  })
})
