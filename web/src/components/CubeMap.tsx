import '../prototype-mode.css'
import { CROSS_LAYOUT, FACE_LABELS } from '../game/faceNavigation'
import type { CubeFace } from '@hidden/game-core'

/*
 * A closed padlock. One glyph for both states: the shackle never opens, the body
 * fills, and the colour turns over. Two glyphs would be two things to read where
 * one already says it, and the word beside it settles any ambiguity.
 */
const PADLOCK_SHACKLE = 'M7 9V6.5a5 5 0 0 1 10 0V9'
const PADLOCK_BODY = 'M4.5 9h15v12.5h-15z'

interface CubeMapProps {
  face: CubeFace
  locked: boolean
  /** The player's own occupied cells per face. Never the opponent's. */
  cellCounts: Readonly<Record<CubeFace, number>>
  onJump: (face: CubeFace) => void
  onToggleLock: () => void
}

/**
 * The cube, unfolded, plus the switch that decides whether you can leave a face.
 *
 * The cross draws 5 of the cube's 12 edges, so this is a picture and not the
 * navigation model — `moveCamera` reads the adjacency table. Jumping by tile is
 * offered anyway, because "take me to BACK" is two arrow presses and one
 * decision, and the decision is the part worth keeping.
 */
export function CubeMap({ face, locked, cellCounts, onJump, onToggleLock }: CubeMapProps) {
  return (
    <section className={`cube-map ${locked ? 'cube-map-locked' : ''}`} aria-label="Cube map">
      <header className="cube-map-header">
        <p>CUBE</p>
        <button
          type="button"
          className={`padlock ${locked ? 'padlock-locked' : ''}`}
          aria-pressed={locked}
          onClick={onToggleLock}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path className="padlock-shackle" d={PADLOCK_SHACKLE} />
            <path className="padlock-body" d={PADLOCK_BODY} />
          </svg>
          <span>{locked ? 'LOCKED' : 'OPEN'}</span>
        </button>
      </header>

      <div className="cube-map-grid">
        {CROSS_LAYOUT.map((slot, index) =>
          slot === null ? (
            <span key={index} className="cube-map-blank" aria-hidden="true" />
          ) : (
            <button
              key={index}
              type="button"
              className={`cube-map-face ${slot === face ? 'cube-map-face-current' : ''}`}
              disabled={locked}
              aria-current={slot === face ? true : undefined}
              onClick={() => onJump(slot)}
            >
              <span className="cube-map-label">{FACE_LABELS[slot]}</span>
              <span className="cube-map-count">{cellCounts[slot]}</span>
            </button>
          ),
        )}
      </div>

      <p className="cube-map-note">
        Debug switch. Locking is not a rule yet — every face is playable.
      </p>
    </section>
  )
}
