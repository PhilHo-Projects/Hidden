import { useCallback, useEffect, useState } from 'react'
import type { CubeFace } from '@hidden/game-core'
import { directionForKey } from '../game/faceNavigation'
import { isTypingTarget } from '../hooks/useFaceCamera'
import { IDENTITY, jumpTo, turn, type CubeMove, type Orientation } from './orientation'

/**
 * The same four directions the flat view uses, and nothing else. `Q`/`E` once
 * rolled the cube in place; see `CubeMove` for why that went.
 */
export function moveForKey(key: string): CubeMove | null {
  return directionForKey(key)
}

export interface CubeOrientationControls {
  readonly orientation: Orientation
  readonly turn: (move: CubeMove) => void
  readonly jump: (face: CubeFace) => void
}

/**
 * Which way round the 3D cube is, for as long as a 3D cube match is on screen.
 *
 * The 3D counterpart of `useFaceCamera`, and deliberately the same shape: the
 * keyboard listener is on `window`, stands down for anything being typed into
 * and for modified keys, and `active` doubles as the reset, so every match
 * starts square on `home`. The cube's animation lives in the scene; this holds
 * only where it is heading.
 */
export function useCubeOrientation(active: boolean): CubeOrientationControls {
  const [orientation, setOrientation] = useState<Orientation>(IDENTITY)
  const [wasActive, setWasActive] = useState(active)

  // Adjusted during render, as `useFaceCamera` does, so a new match never
  // commits a frame of the previous one's last orientation.
  if (wasActive !== active) {
    setWasActive(active)
    if (active) setOrientation(IDENTITY)
  }

  const turnCube = useCallback((move: CubeMove) => {
    setOrientation((current) => turn(current, move))
  }, [])

  const jump = useCallback((face: CubeFace) => {
    setOrientation((current) => jumpTo(current, face))
  }, [])

  useEffect(() => {
    if (!active) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const move = moveForKey(event.key)
      if (!move) return

      event.preventDefault()
      turnCube(move)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, turnCube])

  return { orientation, turn: turnCube, jump }
}
