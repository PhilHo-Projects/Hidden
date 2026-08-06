import '../animations/cell-destruction.css'
import '../animations/score-count.css'
import shieldIcon from '../assets/icons/battle/powerup-immune.png'
import type { GridState, PaintColor } from '../game/types'
import type { CSSProperties } from 'react'

export interface CellDestructionEffect {
  id: number
  tone: 'loss' | 'victory'
}

// The result count-up walks the scored cells one at a time. Keep the step long
// enough to follow by eye; `score-count.css` replays the whole walk on a loop.
const SCORE_STEP_MS = 340
const SCORE_CELL_OFFSET_MS = 500
const SCORE_BADGE_OFFSET_MS = 590

interface BoardGridProps {
  title: string
  subtitle: string
  grid: GridState
  hidden?: boolean
  compact?: boolean
  interactive?: boolean
  selectedColor?: PaintColor | null
  destructionEffects?: Partial<Record<number, CellDestructionEffect>>
  scoreCountLabels?: Partial<Record<number, number>>
  onSelect?: (index: number) => void
}

// Boards are always square, so the column count is recoverable from the cell
// count. Deriving it here avoids threading board size through every call site.
function boardColumns(cellCount: number) {
  if (cellCount <= 0) return 3
  return Math.round(Math.sqrt(cellCount))
}

// Hand-cut edges come from a handful of clip-path variants rather than one
// shape stamped nine times. Deriving the variant from the index keeps a cell
// looking the same across every render, and the stride guarantees neighbours
// never draw the same cut.
const CELL_VARIANTS = 4

function cellVariant(index: number) {
  return (index * 3 + 1) % CELL_VARIANTS
}

function cellTone(color: PaintColor | null, hidden: boolean, occupied: boolean) {
  if (!occupied) return '#f5f5f5'
  if (hidden) return 'linear-gradient(145deg, #383838, #080808)'

  return color ?? '#F2EEE7'
}

export function BoardGrid({
  title,
  subtitle,
  grid,
  hidden = false,
  compact = false,
  interactive = false,
  selectedColor,
  destructionEffects = {},
  scoreCountLabels = {},
  onSelect,
}: BoardGridProps) {
  return (
    <section
      className={`unity-board ${interactive ? 'unity-board-interactive' : ''} ${
        compact ? 'unity-board-compact' : ''
      }`}
    >
      <header className="unity-board-header">
        <div>
          {title ? <p>{title}</p> : null}
          <h3>{subtitle}</h3>
        </div>
        {selectedColor ? (
          <span className="loaded-color" style={{ backgroundColor: selectedColor }} aria-label="Loaded move">
            Loaded
          </span>
        ) : null}
      </header>

      <div
        className="unity-board-grid"
        style={
          {
            '--board-size': String(boardColumns(grid.cells.length)),
          } as CSSProperties
        }
      >
        {grid.cells.map((cell, index) => {
          const isClickable = interactive && typeof onSelect === 'function'
          const destructionEffect = destructionEffects[index]
          const scoreCount = scoreCountLabels[index]

          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelect?.(index)}
              disabled={!isClickable}
              aria-label={
                scoreCount
                  ? `Cell ${index + 1}, Point ${scoreCount}`
                  : `Cell ${index + 1}`
              }
              className={`unity-cell ${cell.occupied ? 'unity-cell-occupied' : ''} ${
                hidden && cell.occupied ? 'unity-cell-hidden' : ''
              } ${isClickable ? 'unity-cell-clickable' : ''} ${
                destructionEffect ? `unity-cell-destroying-${destructionEffect.tone}` : ''
              } ${scoreCount ? 'unity-cell-score-counted' : ''} unity-cell-v${cellVariant(index)}`}
              style={{
                background: cellTone(cell.color, hidden, cell.occupied),
                '--score-order': scoreCount ?? 0,
                '--score-delay': `${scoreCount ? (scoreCount - 1) * SCORE_STEP_MS + SCORE_CELL_OFFSET_MS : 0}ms`,
                '--score-badge-delay': `${scoreCount ? (scoreCount - 1) * SCORE_STEP_MS + SCORE_BADGE_OFFSET_MS : 0}ms`,
              } as CSSProperties}
            >
              {/* The cell index is carried by `aria-label` above rather than
                * printed. On the board it read as clutter; screen readers still
                * need it to tell one cell from another. */}
              {cell.occupied && hidden ? (
                <span className="hidden-marker">
                  <span />
                </span>
              ) : null}

              {cell.immune ? (
                <span className="immune-marker">
                  <img src={shieldIcon} alt="" />
                </span>
              ) : null}

              {scoreCount ? (
                <span className="score-count-badge" aria-hidden="true">
                  {scoreCount}
                </span>
              ) : null}

              {destructionEffect ? (
                <span
                  key={destructionEffect.id}
                  className={`cell-destruction cell-destruction-${destructionEffect.tone}`}
                  aria-hidden="true"
                >
                  <span className="cell-destruction__ring" />
                  <span className="cell-destruction__core" />
                  {Array.from({ length: 6 }, (_, shardIndex) => (
                    <span
                      key={shardIndex}
                      className="cell-destruction__shard"
                      style={
                        {
                          '--shard-index': shardIndex,
                          '--shard-angle': `${shardIndex * 60}deg`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
