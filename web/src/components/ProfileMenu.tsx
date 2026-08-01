import { useEffect, useId, useRef, useState } from 'react'

interface ProfileMenuProps {
  username: string
  busy: boolean
  disabled: boolean
  onSignOut: () => void
}

/**
 * Sections that have a home in the menu before they have an implementation.
 * They stay visible and disabled so the shape of the account area is settled
 * now, rather than moving under the player each time one of them lands.
 */
const UPCOMING_SECTIONS = [
  { label: 'Match history', detail: 'Past matches and how they ended' },
  { label: 'Stats', detail: 'Win rate, streaks, favourite moves' },
  { label: 'Preferences', detail: 'Sound, motion, and display' },
] as const

/**
 * The account slot in the top bar. A disclosure rather than an ARIA menu: the
 * items are ordinary buttons reached with Tab, which is honest about the
 * keyboard behaviour actually implemented. Escape closes and returns focus.
 */
export function ProfileMenu({
  username,
  busy,
  disabled,
  onSignOut,
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const unavailable = disabled || busy

  /*
   * The panel must never outlive the control that owns it: a match starting
   * while the menu is open would otherwise leave it stranded over the board.
   * Adjusted during render rather than in an effect, so the closed panel is
   * never painted for a frame first, and so re-enabling the trigger later does
   * not pop a menu the player has forgotten about.
   */
  const [lockedOut, setLockedOut] = useState(unavailable)
  if (lockedOut !== unavailable) {
    setLockedOut(unavailable)
    if (unavailable) setOpen(false)
  }

  useEffect(() => {
    if (!open) return

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="profile-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="nav-brush-button nav-account-button profile-menu-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={unavailable}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="profile-menu-name">{busy ? 'WAIT...' : username}</span>
        <span className="profile-menu-caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="profile-menu-panel" id={panelId}>
          <p className="profile-menu-heading">
            <span>Signed in as</span>
            <strong>{username}</strong>
          </p>

          <ul className="profile-menu-list">
            {UPCOMING_SECTIONS.map((section) => (
              <li key={section.label}>
                <button type="button" className="profile-menu-item" disabled>
                  <span className="profile-menu-item-label">
                    {section.label}
                  </span>
                  <span className="profile-menu-item-detail">
                    {section.detail}
                  </span>
                  <small className="profile-menu-badge">Soon</small>
                </button>
              </li>
            ))}

            <li>
              <button
                type="button"
                className="profile-menu-item profile-menu-signout"
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
              >
                <span className="profile-menu-item-label">Sign out</span>
                <span className="profile-menu-item-detail">
                  Return to guest play on this browser
                </span>
              </button>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  )
}
