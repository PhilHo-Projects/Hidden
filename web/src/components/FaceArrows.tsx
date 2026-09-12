import '../prototype-mode.css'
import { neighbourFace, type CubeFace, type FaceDirection } from '@hidden/game-core'
import { FACE_LABELS } from '../game/faceNavigation'

const DIRECTIONS: readonly FaceDirection[] = ['north', 'east', 'south', 'west']

/*
 * A brace, drawn as a filled outline rather than a stroked line.
 *
 * A stroke has one weight everywhere and reads as a bracket. This path's two
 * edges converge at both terminals and part at the cusp, so the mark thins,
 * swells, and thins again the way a brush does — which is the board's own
 * language, and the reason these are braces and not chevrons.
 *
 * Drawn once, pointing east, and rotated by CSS for the other three. The
 * viewBox is tall and the button is square, so the default `meet` fit centres
 * the mark and every side gets the same glyph at the same scale.
 */
const BRACE_PATH =
  'M4 1.5C13.5 8.5 10.5 24 20.5 32C10.5 40 13.5 55.5 4 62.5L5.2 60.8' +
  'C13.2 54 10.2 39.5 16.8 32C10.2 24.5 13.2 10 5.2 3.2Z'

interface FaceArrowsProps {
  face: CubeFace
  locked: boolean
  onMove: (direction: FaceDirection) => void
}

/**
 * The four ways off this face.
 *
 * Drawn from `CUBE_ADJACENCY`, not from the map, so west from `up` offers
 * `left` even though the cross draws the two apart.
 */
export function FaceArrows({ face, locked, onMove }: FaceArrowsProps) {
  return (
    <>
      {DIRECTIONS.map((direction) => (
        <button
          key={direction}
          type="button"
          className={`face-arrow face-arrow-${direction} ${locked ? 'face-arrow-locked' : ''}`}
          disabled={locked}
          onClick={() => onMove(direction)}
          aria-label={`Move to ${FACE_LABELS[neighbourFace(face, direction)]}`}
        >
          <svg viewBox="0 0 24 64" aria-hidden="true" focusable="false">
            <path d={BRACE_PATH} />
          </svg>
        </button>
      ))}
    </>
  )
}
