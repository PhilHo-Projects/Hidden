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
