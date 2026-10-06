import { Suspense } from 'react'
import './cube3d.css'
import type { CubeFace } from '@hidden/game-core'
import type { GridState } from '../game/types'
import { Cube3DBoundary } from './Cube3DBoundary'
import { LazyMiniCanvas } from './lazy'
import type { Orientation } from './orientation'

interface MiniCubeProps {
  /** The player's own board. Never the opponent's. */
  grid: GridState
  activeFace: CubeFace
  /** The main cube's orientation, which this one follows. */
  orientation: Orientation
  onJump: (face: CubeFace) => void
}

/**
 * Where your pieces are, on a cube that turns with the one you are playing.
 * Takes the unfolded map's place in the 3D view.
 *
 * It mirrors the main cube rather than holding an orientation of its own, so
 * the two never disagree about which way round the board is. Dragging still
 * spins it, because looking for your pieces on a far face should not cost a
 * turn -- but that is a peek, and the next turn pulls it back into step.
 */
export function MiniCube({ grid, activeFace, orientation, onJump }: MiniCubeProps) {
  return (
    <section className="cube3d-mini" aria-label="Cube">
      <p className="cube3d-mini-title">CUBE</p>
      <div className="cube3d-mini-stage">
        <Cube3DBoundary fallback={null}>
          <Suspense fallback={null}>
            <LazyMiniCanvas
              grid={grid}
              activeFace={activeFace}
              orientation={orientation}
              onJump={onJump}
            />
          </Suspense>
        </Cube3DBoundary>
      </div>
      <p className="cube3d-mini-note">Drag to spin · tap a face to go there</p>
    </section>
  )
}
