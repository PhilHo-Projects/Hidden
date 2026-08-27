import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import '../animations/reveal-snapshot.css'
import { BoardGrid } from './BoardGrid'
import type { GridState } from '../game/types'
import type { CSSProperties } from 'react'

interface RevealSnapshotProps {
  open: boolean
  opponentName: string
  grid: GridState
  /** Window length in seconds, so the bulbs run out with the authority's timer. */
  seconds: number
  onClose: () => void
}

/*
 * Bulbs per edge. The two counts differ because the card is taller than it is
 * wide and the bulbs have to stay evenly spaced along the border rather than
 * evenly divided between the sides.
 */
const BULBS_ACROSS = 11
const BULBS_DOWN = 17

/** Past this fraction the remaining bulbs go red and blink. */
const URGENT_FROM = 0.75

/*
 * Perimeter positions, clockwise from the top-left. Walking the border in the
 * order the eye travels is what makes the bulbs read as a countdown rather than
 * as decoration switching off at random.
 */
function bulbPositions() {
  const points: { left: string; top: string }[] = []
  for (let i = 0; i < BULBS_ACROSS; i += 1) {
    points.push({ left: `${(100 * i) / BULBS_ACROSS}%`, top: '0%' })
  }
  for (let i = 0; i < BULBS_DOWN; i += 1) {
    points.push({ left: '100%', top: `${(100 * i) / BULBS_DOWN}%` })
  }
  for (let i = BULBS_ACROSS; i > 0; i -= 1) {
    points.push({ left: `${(100 * i) / BULBS_ACROSS}%`, top: '100%' })
  }
  for (let i = BULBS_DOWN; i > 0; i -= 1) {
    points.push({ left: '0%', top: `${(100 * i) / BULBS_DOWN}%` })
  }
  return points
}

const BULBS = bulbPositions()

/**
 * The opponent's board, for as long as the reveal window lasts.
 *
 * Covers the match screen outright rather than sitting beside the player's own
 * board. Taking the player's board away is the point: it is what makes this a
 * snapshot to memorise instead of a reference to consult, and it is the only
 * thing that fits a phone.
 *
 * The countdown is the frame. Bulbs go out one at a time around the border, so
 * there is no progress bar and no number competing with the board for the
 * second and a half the player has to read it.
 */
export function RevealSnapshot({
  open,
  opponentName,
  grid,
  seconds,
  onClose,
}: RevealSnapshotProps) {
  const titleId = useId()
  const [progress, setProgress] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  const closeRef = useRef(onClose)

  // Adjusted during render rather than in an effect, the same way
  // `useDesecrationRelease` does: this is derived from a prop change, so React
  // can re-render immediately without committing the in-between result. From an
  // effect it would commit one frame of the previous countdown's burnt-down
  // frame before resetting -- a snapshot that opens with its time already spent.
  if (wasOpen !== open) {
    setWasOpen(open)
    setProgress(0)
  }

  // Kept in a ref so the driver below depends on the window alone. Re-running
  // it because a parent re-rendered would restart the countdown mid-snapshot.
  useLayoutEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    /*
     * Driven off `performance.now()` rather than a bulb-per-tick interval. The
     * authority closes the window on wall time, so the frame has to measure the
     * same thing or the last bulbs and the actual close drift apart on a slow
     * frame.
     */
    const started = performance.now()
    const total = Math.max(1, seconds * 1000)
    let frame = 0

    const step = () => {
      const elapsed = (performance.now() - started) / total
      setProgress(Math.min(1, elapsed))
      if (elapsed < 1) {
        frame = requestAnimationFrame(step)
        return
      }
      // Offline this closes the window; online the authority's own expiry is
      // already on its way and `end-reveal` is idempotent, so whichever lands
      // first wins and the other is inert.
      closeRef.current()
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [open, seconds])

  if (!open) return null

  /*
   * Bulbs go dark in index order, and the index order runs clockwise from the
   * top-left, so the darkness chases the border the way a clock hand does and
   * the last bulb still burning is the one just short of a full lap.
   *
   * Counting the dark ones rather than the lit ones is what fixes the
   * direction: taking `lit` off the end would extinguish the highest indices
   * first, which walks the border backwards.
   */
  const spent = Math.floor(BULBS.length * progress)

  return (
    <div className="reveal-snapshot" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={`reveal-frame ${progress > URGENT_FROM ? 'reveal-frame-urgent' : ''}`}>
        <div className="reveal-card">
          {/* Naming the owner is load-bearing. Two boards in this game look
            * exactly alike, and a player who reads this as their own has been
            * told the opposite of the truth. */}
          <p className="reveal-title" id={titleId}>
            OPPONENT&apos;S BOARD
          </p>
          <p className="reveal-who">{opponentName} · memorise it</p>
          <BoardGrid title="" subtitle="" grid={grid} showDesecration={false} />
        </div>

        <div className="reveal-bulbs" aria-hidden="true">
          {BULBS.map((position, index) => (
            <span
              key={index}
              className={`reveal-bulb ${index < spent ? 'reveal-bulb-off' : ''}`}
              style={position as CSSProperties}
            />
          ))}
        </div>
      </div>

      {/* The whole backdrop closes it. Once the board is memorised the snapshot
        * is only in the way, and hunting for a small target costs the player
        * the time they just saved. */}
      <button type="button" className="reveal-dismiss" onClick={onClose}>
        Close and play
      </button>
    </div>
  )
}
