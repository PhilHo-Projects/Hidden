import { Suspense } from 'react'
import './cube3d.css'
import type { CubeFace } from '@hidden/game-core'
import type { GridState } from '../game/types'
import { Cube3DBoundary } from './Cube3DBoundary'
import { LazyMiniCanvas } from './lazy'

interface MiniCubeProps {
  /** The player's own board. Never the opponent's. */
  grid: GridState
  activeFace: CubeFace
  onJump: (face: CubeFace) => void
}

/**
 * Where your pieces are, on a cube you can spin by hand. Takes the unfolded
 * map's place in the 3D view. Its orientation is its own: turning the main
 * cube does not spin it, and spinning it does not turn the main cube -- only a
 * tap on a face does that.
 */
export function MiniCube({ grid, activeFace, onJump }: MiniCubeProps) {
  return (
    <section className="cube3d-mini" aria-label="Cube">
      <p className="cube3d-mini-title">CUBE</p>
      <div className="cube3d-mini-stage">
        <Cube3DBoundary fallback={null}>
          <Suspense fallback={null}>
            <LazyMiniCanvas grid={grid} activeFace={activeFace} onJump={onJump} />
          </Suspense>
        </Cube3DBoundary>
      </div>
      <p className="cube3d-mini-note">Drag to spin · tap a face to go there</p>
    </section>
  )
}
