import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CubeFace } from '@hidden/game-core'
import type { GridState } from '../game/types'
import { CubeScene } from './scene'
import { tileVisual } from './tileVisuals'

/** Small enough that a three-quarter view never clips its corners. */
const MINI_FACE_FILL = 0.5

interface MiniCanvasProps {
  grid: GridState
  activeFace: CubeFace
  onJump: (face: CubeFace) => void
}

export function MiniCanvas({ grid, activeFace, onJump }: MiniCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scene, setScene] = useState<CubeScene | null>(null)
  const [failed, setFailed] = useState(false)
  const onJumpRef = useRef(onJump)

  useLayoutEffect(() => {
    onJumpRef.current = onJump
  }, [onJump])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let created: CubeScene | null = null

    CubeScene.create(canvas, {
      mode: 'mini',
      faceFraction: MINI_FACE_FILL,
      onFacePick: (face) => onJumpRef.current(face),
      onContextLost: () => setFailed(true),
    }).then(
      (made) => {
        if (cancelled) {
          made.dispose()
          return
        }
        created = made
        setScene(made)
      },
      // The board shows the fallback; the map just steps aside.
      () => {
        if (!cancelled) setFailed(true)
      },
    )

    return () => {
      cancelled = true
      created?.dispose()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!scene || !canvas) return
    const fit = () => scene.resize(canvas.clientWidth, canvas.clientHeight)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [scene])

  useEffect(() => {
    scene?.setTiles(grid.cells.map(tileVisual))
  }, [scene, grid])

  useEffect(() => {
    scene?.setHighlightFace(activeFace)
  }, [scene, activeFace])

  if (failed) return null
  return <canvas ref={canvasRef} className="cube3d-mini-canvas" aria-hidden="true" />
}
