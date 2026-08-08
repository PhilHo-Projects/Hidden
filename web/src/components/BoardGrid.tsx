import { useEffect, useState } from 'react'
import '../animations/cell-desecration.css'
import '../animations/cell-destruction.css'
import '../animations/score-count.css'
import shieldIcon from '../assets/icons/battle/powerup-immune.png'
import { COLOR_BY_SYMBOL } from '../game/constants'
import type { GridState } from '../game/types'
import type { ClassicSymbol } from '@hidden/game-core'
import type { CSSProperties } from 'react'

export interface CellDestructionEffect {
  id: number
  /**
   * Only losses animate. A victory tone existed for destroying an opponent
   * square, but showing it told the placing player their square had killed
   * something, which is exactly the information a blind board withholds.
   */
  tone: 'loss'
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
  /** Off for the result boards: desecration is a constraint on the next move,
   * and there is no next move once the match is scored. */
  showDesecration?: boolean
  selectedSymbol?: ClassicSymbol | null
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

function cellTone(symbol: ClassicSymbol | null, hidden: boolean, occupied: boolean) {
  if (!occupied) return '#f5f5f5'
  if (hidden) return 'linear-gradient(145deg, #383838, #080808)'

  return symbol ? COLOR_BY_SYMBOL[symbol] : '#F2EEE7'
}

// Long enough to read as a thaw rather than a flicker.
const DESECRATION_RELEASE_MS = 800

/**
 * Indices whose desecration just ended, held for the length of the fade.
 *
 * Removing a class cannot start an animation, so the overlay has to outlive the
 * state that created it. Keyed on a string of the flags rather than the cell
 * array, which is a new object every render.
 */
function useDesecrationRelease(desecrationKey: string, enabled: boolean) {
  const [previousKey, setPreviousKey] = useState(desecrationKey)
  const [releasing, setReleasing] = useState<ReadonlySet<number>>(new Set())

  // Adjusted during render rather than in an effect. This is derived from a prop
  // change, so React can re-render immediately without committing the in-between
  // result; an effect would commit one render with the overlay already gone and
  // then cascade a second to bring it back, which shows as a flicker.
  if (previousKey !== desecrationKey) {
    setPreviousKey(desecrationKey)
    const freed: number[] = []
    if (enabled) {
      for (let index = 0; index < desecrationKey.length; index += 1) {
        if (previousKey[index] === '1' && desecrationKey[index] === '0') freed.push(index)
      }
    }
    if (freed.length > 0) {
      setReleasing((current) => new Set([...current, ...freed]))
    }
  }

  // One timer for the whole board. A release arriving mid-fade restarts it,
  // which costs nothing: the extra time is spent already fully transparent.
  useEffect(() => {
    if (releasing.size === 0) return
    const timeoutId = window.setTimeout(
      () => setReleasing(new Set()),
      DESECRATION_RELEASE_MS,
    )
    return () => window.clearTimeout(timeoutId)
  }, [releasing])

  return releasing
}

export function BoardGrid({
  title,
  subtitle,
  grid,
  hidden = false,
  compact = false,
  interactive = false,
  showDesecration = true,
  selectedSymbol,
  destructionEffects = {},
  scoreCountLabels = {},
  onSelect,
}: BoardGridProps) {
  const desecrationKey = grid.cells
    .map((cell) => (cell.desecrated && !cell.occupied ? '1' : '0'))
    .join('')
  const releasing = useDesecrationRelease(desecrationKey, showDesecration)

  return (
    <section
      className={`hidden-board ${interactive ? 'hidden-board-interactive' : ''} ${
        compact ? 'hidden-board-compact' : ''
      }`}
    >
      <header className="hidden-board-header">
        <div>
          {title ? <p>{title}</p> : null}
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

      <div
        className="hidden-board-grid"
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
          const desecrated = showDesecration && cell.desecrated && !cell.occupied
          const isReleasing = !desecrated && releasing.has(index)

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
              className={`hidden-cell ${cell.occupied ? 'hidden-cell-occupied' : ''} ${
                hidden && cell.occupied ? 'hidden-cell-hidden' : ''
              } ${desecrated ? 'hidden-cell-desecrated' : ''} ${
                isClickable ? 'hidden-cell-clickable' : ''
              } ${
                destructionEffect ? `hidden-cell-destroying-${destructionEffect.tone}` : ''
              } ${scoreCount ? 'hidden-cell-score-counted' : ''} hidden-cell-v${cellVariant(index)}`}
              style={{
                background: cellTone(cell.symbol, hidden, cell.occupied),
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

              {desecrated || isReleasing ? (
                <span
                  className={`cell-desecration ${
                    isReleasing ? 'cell-desecration-releasing' : ''
                  }`}
                  aria-hidden="true"
                />
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
