import { Suspense, useState } from 'react'
import '../prototype-mode.css'
import './cube3d.css'
import type { ClassicSymbol } from '@hidden/game-core'
import { FaceArrows } from '../components/FaceArrows'
import { COLOR_BY_SYMBOL } from '../game/constants'
import type { GridState } from '../game/types'
import type { DestructionEffectMap } from '../hooks/useDestructionEffects'
import { Cube3DBoundary, Cube3DFallback } from './Cube3DBoundary'
import { LazyBoardCanvas } from './lazy'
import { frontFace, screenNeighbours, type CubeMove, type Orientation } from './orientation'

// A quarter arc with an arrowhead, drawn once and mirrored for clockwise.
const ROLL_PATH = 'M6 15a8 8 0 1 0 2.3-9.6M6 3v5h5'

interface CubeBoard3DProps {
  subtitle: string
  grid: GridState
  orientation: Orientation
  interactive: boolean
  selectedSymbol: ClassicSymbol | null
  destructionEffects: DestructionEffectMap
  onSelect: (locationId: number) => void
  onTurn: (move: CubeMove) => void
  onUseFlat: () => void
}

/**
 * The played board, as a cube.
 *
 * Everything here is ordinary DOM in the main chunk: header, arrows, roll
 * buttons and the board's square. Only the canvas inside the square is lazy,
 * so the frame lays out and the arrows work before three.js has arrived, and
 * the arena sizes this exactly as it sizes `BoardGrid`.
 */
export function CubeBoard3D({
  subtitle,
  grid,
  orientation,
  interactive,
  selectedSymbol,
  destructionEffects,
  onSelect,
  onTurn,
  onUseFlat,
}: CubeBoard3DProps) {
  // A callback ref into state, so the canvas mounts once its square exists and
  // the scene can read the pointer from it.
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const fallback = <Cube3DFallback onUseFlat={onUseFlat} />

  return (
    <section
      className={`hidden-board cube3d-board ${interactive ? 'hidden-board-interactive' : ''}`}
    >
      <header className="hidden-board-header">
        <div>
          <p>Player Board</p>
          <h3>{subtitle}</h3>
        </div>
        {selectedSymbol ? (
          <span
            className="loaded-color"
            style={{ backgroundColor: COLOR_BY_SYMBOL[selectedSymbol] }}
            aria-label="Loaded move"
          >
            Loaded
          </span>
        ) : null}
      </header>

      <div className="face-frame">
        <FaceArrows
          face={frontFace(orientation)}
          locked={false}
          neighbours={screenNeighbours(orientation)}
          onMove={onTurn}
        />
        <button
          type="button"
          className="cube3d-roll cube3d-roll-ccw"
          onClick={() => onTurn('ccw')}
          aria-label="Roll the cube counter-clockwise"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={ROLL_PATH} />
          </svg>
        </button>
        <button
          type="button"
          className="cube3d-roll cube3d-roll-cw"
          onClick={() => onTurn('cw')}
          aria-label="Roll the cube clockwise"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={ROLL_PATH} />
          </svg>
        </button>

        <div className="hidden-board-grid cube3d-stage" ref={setStage}>
          {failed ? (
            fallback
          ) : stage ? (
            <Cube3DBoundary fallback={fallback}>
              <Suspense fallback={null}>
                <LazyBoardCanvas
                  grid={grid}
                  orientation={orientation}
                  interactive={interactive}
                  destructionEffects={destructionEffects}
                  stage={stage}
                  onSelect={onSelect}
                  onFailure={() => setFailed(true)}
                />
              </Suspense>
            </Cube3DBoundary>
          ) : null}
        </div>
      </div>
    </section>
  )
}
