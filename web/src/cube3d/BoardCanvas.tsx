import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GridState } from '../game/types'
import type { DestructionEffectMap } from '../hooks/useDestructionEffects'
import type { Orientation } from './orientation'
import { CubeScene } from './scene'
import { tileVisual } from './tileVisuals'

/*
 * The canvas is 150% of the board's square and centred on it, because a cube
 * turning under a fixed camera sweeps well past its own face. Kept in step with
 * `.cube3d-canvas`'s inset in cube3d.css.
 */
const CANVAS_SCALE = 1.5
/** Share of the square the front face fills at rest, leaving the bevel room. */
const BOARD_FACE_FILL = 0.96

interface BoardCanvasProps {
  grid: GridState
  orientation: Orientation
  interactive: boolean
  destructionEffects: DestructionEffectMap
  /** The board's own square; the pointer is read here. See `CubeSceneOptions.pointerTarget`. */
  stage: HTMLElement
  onSelect: (locationId: number) => void
  onFailure: () => void
}

export function BoardCanvas({
  grid,
  orientation,
  interactive,
  destructionEffects,
  stage,
  onSelect,
  onFailure,
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scene, setScene] = useState<CubeScene | null>(null)
  const onSelectRef = useRef(onSelect)
  const onFailureRef = useRef(onFailure)
  const playedRef = useRef<Set<number>>(new Set())

  // Kept in refs so the scene is built once per mount, not once per render.
  useLayoutEffect(() => {
    onSelectRef.current = onSelect
    onFailureRef.current = onFailure
  }, [onSelect, onFailure])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let created: CubeScene | null = null

    CubeScene.create(canvas, {
      mode: 'board',
      faceFraction: BOARD_FACE_FILL / CANVAS_SCALE,
      pointerTarget: stage,
      onPick: (locationId) => onSelectRef.current(locationId),
      onContextLost: () => onFailureRef.current(),
    }).then(
      (made) => {
        // Unmounted while loading -- React's development double-mount does this.
        if (cancelled) {
          made.dispose()
          return
        }
        created = made
        setScene(made)
      },
      () => {
        if (!cancelled) onFailureRef.current()
      },
    )

    return () => {
      cancelled = true
      created?.dispose()
    }
  }, [stage])

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
    scene?.setOrientation(orientation)
  }, [scene, orientation])

  useEffect(() => {
    scene?.setTiles(grid.cells.map(tileVisual))
  }, [scene, grid])

  useEffect(() => {
    scene?.setInteractive(interactive)
  }, [scene, interactive])

  // Each effect carries an id, so the same loss never plays twice.
  useEffect(() => {
    if (!scene) return
    for (const [location, effect] of Object.entries(destructionEffects)) {
      if (!effect || playedRef.current.has(effect.id)) continue
      playedRef.current.add(effect.id)
      scene.playLoss(Number(location))
    }
  }, [scene, destructionEffects])

  return <canvas ref={canvasRef} className="cube3d-canvas" aria-hidden="true" />
}
