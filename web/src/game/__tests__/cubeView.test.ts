import { describe, expect, it } from 'vitest'
import { readCubeView, writeCubeView } from '../cubeView'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  }
}

const throwing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('the remembered cube view', () => {
  it('defaults to flat', () => {
    expect(readCubeView(memoryStorage())).toBe('flat')
    expect(readCubeView(undefined)).toBe('flat')
  })

  it('remembers 3D', () => {
    const storage = memoryStorage()
    writeCubeView('3d', storage)
    expect(storage.values.get('hidden.cubeView')).toBe('3d')
    expect(readCubeView(storage)).toBe('3d')
  })

  it('treats anything unrecognised as flat', () => {
    expect(readCubeView(memoryStorage({ 'hidden.cubeView': 'hologram' }))).toBe('flat')
  })

  it('survives storage that refuses to be used', () => {
    // A private window or blocked site data throws on access. A preference is
    // not worth an error screen.
    expect(readCubeView(throwing)).toBe('flat')
    expect(() => writeCubeView('3d', throwing)).not.toThrow()
  })
})
