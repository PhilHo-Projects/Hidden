import { useEffect, useId, useRef } from 'react'
import extraTurnIcon from '../assets/icons/battle/powerup-extra-turn.png'
import immuneIcon from '../assets/icons/battle/powerup-immune.png'
import revealIcon from '../assets/icons/battle/powerup-reveal.png'

interface HowToPlayModalProps {
  open: boolean
  onClose: () => void
}

interface HowToPlayTriggerProps {
  onClick: () => void
}

/*
 * Rules copy has to survive every GameConfig. boardSize, streak, rounds, and
 * powerupBySymbol are all knobs a host can turn, so nothing here names a line
 * length, a round count, or which symbol unlocks which power-up. "A full line"
 * and "its own power-up" stay true whatever the host picked; "three in a row"
 * would be a lie on a 4x4 board with streak 4.
 */
const RULES = [
  {
    heading: "You can't see their board",
    body: 'You and your opponent fill the same grid, each on your own board. Where they have played stays hidden until the match ends.',
  },
  {
    heading: 'Every square is rock, paper, scissors',
    body: 'Load a move, then place it. If you both claimed the same square, rock, paper, scissors decides who keeps it. Play the same move and you both lose the square.',
  },
  {
    heading: 'Most squares held wins',
    body: 'When the rounds run out, count what is still standing on each board. The bigger pile takes the match.',
  },
  {
    heading: 'Complete a line to unlock a power-up',
    body: 'Fill a full row, column, or diagonal with one symbol and that symbol hands you its power-up. Each one can be spent once.',
  },
] as const

const POWERUPS = [
  { icon: immuneIcon, label: 'Immune' },
  { icon: revealIcon, label: 'Reveal' },
  { icon: extraTurnIcon, label: 'Extra turn' },
] as const

/**
 * The first modal in the app, so it sets the pattern: absent from the tree when
 * closed, Escape and backdrop press both close, and focus moves in on open and
 * is handed back to whatever opened it on close.
 *
 * There is no focus trap. Focus is moved and restored, but Tab can still leave
 * the dialog. That is a known gap rather than an oversight.
 */
export function HowToPlayModal({ open, onClose }: HowToPlayModalProps) {
  const headingId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  /*
   * Focus is keyed on `open` alone, deliberately apart from the Escape
   * listener below. Callers pass `onClose` inline, so it has a new identity on
   * every render of the screen behind the dialog; including it here would tear
   * this effect down and rebuild it on each of those renders, handing focus
   * back to the trigger and stealing it again every time. During a match, where
   * the turn timer re-renders continuously, that thrashes.
   */
  useEffect(() => {
    if (!open) return

    // Captured before focus moves, so it is the element that actually opened
    // the dialog rather than the close button.
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    return () => previouslyFocused?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="howto-overlay"
      role="presentation"
      /*
       * Only a press that both starts and ends on the backdrop closes. Without
       * the target check, releasing a text selection that began inside the panel
       * would dismiss the dialog.
       */
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="howto-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <div className="howto-panel-inner">
          <button
            ref={closeRef}
            type="button"
            className="howto-close"
            aria-label="Close"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>

          <header className="howto-header">
            <p className="howto-kicker">HOW TO PLAY</p>
            <h2 id={headingId}>HIDDEN</h2>
          </header>

          <ol className="howto-rules">
            {RULES.map((rule, index) => (
              <li key={rule.heading} className="howto-rule">
                <span className="howto-rule-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="howto-rule-copy">
                  <h3>{rule.heading}</h3>
                  <p>{rule.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="howto-powerups">
            {POWERUPS.map((powerup) => (
              <span key={powerup.label} className="howto-powerup">
                <img src={powerup.icon} alt="" />
                <small>{powerup.label}</small>
              </span>
            ))}
          </div>

          <p className="howto-note">
            Hidden is still being built and its rules are still being tuned.
            Expect this page to change.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * The fanned question cards that open the modal. Drawn in CSS from the shipped
 * palette rather than loaded as art, so it costs no request and no build weight.
 * Swapping in an image later means replacing the three spans.
 */
export function HowToPlayTrigger({ onClick }: HowToPlayTriggerProps) {
  return (
    <button
      type="button"
      className="howto-trigger"
      aria-label="How to play"
      onClick={onClick}
    >
      <span className="howto-trigger-cards" aria-hidden="true">
        <span className="howto-card howto-card-red">?</span>
        <span className="howto-card howto-card-blue">?</span>
        <span className="howto-card howto-card-green">?</span>
      </span>
    </button>
  )
}
