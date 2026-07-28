import type { GridState, PaintColor } from '../game/types'

interface BoardGridProps {
  title: string
  subtitle: string
  grid: GridState
  hidden?: boolean
  interactive?: boolean
  selectedColor?: PaintColor | null
  onSelect?: (index: number) => void
}

const ASSET = '/assets'

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
  interactive = false,
  selectedColor,
  onSelect,
}: BoardGridProps) {
  return (
    <section className={`unity-board ${interactive ? 'unity-board-interactive' : ''}`}>
      <header className="unity-board-header">
        <div>
          <p>{title}</p>
          <h3>{subtitle}</h3>
        </div>
        {selectedColor ? (
          <span className="loaded-color" style={{ backgroundColor: selectedColor }} aria-label="Loaded move">
            Loaded
          </span>
        ) : null}
      </header>

      <div className="unity-board-grid">
        {grid.cells.map((cell, index) => {
          const isClickable = interactive && typeof onSelect === 'function'

          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelect?.(index)}
              disabled={!isClickable}
              className={`unity-cell ${cell.occupied ? 'unity-cell-occupied' : ''} ${
                hidden && cell.occupied ? 'unity-cell-hidden' : ''
              } ${isClickable ? 'unity-cell-clickable' : ''}`}
              style={{
                background: cellTone(cell.color, hidden, cell.occupied),
              }}
            >
              <span className="unity-cell-number">{index + 1}</span>

              {cell.occupied && hidden ? (
                <span className="hidden-marker">
                  <span />
                </span>
              ) : null}

              {cell.immune ? (
                <span className="immune-marker">
                  <img src={`${ASSET}/shield.png`} alt="" />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
