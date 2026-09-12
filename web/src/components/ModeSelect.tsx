import '../prototype-mode.css'
import {
  PROTOTYPE_WARNING,
  VARIANT_DESCRIPTIONS,
  VARIANT_LABELS,
} from '../game/constants'
import type { GameVariant } from '@hidden/game-core'

const VARIANTS: readonly GameVariant[] = ['main', 'prototype']

interface ModeSelectProps {
  value: GameVariant
  onChange: (variant: GameVariant) => void
}

/**
 * Picks which game a match will be.
 *
 * Switching modes replaces the whole config rather than patching one field --
 * see `defaultConfigForVariant`. A 5x5 board tuned for `main` is not something
 * `prototype` can honour, so carrying settings across would only produce a
 * config the clamp silently rewrites.
 *
 * Selecting the prototype recolours the control red rather than the system's
 * usual yellow. Yellow everywhere else in Hidden means "selected, and fine";
 * this mode is not fine, and making the control itself carry the hazard is what
 * stops it being entered by accident.
 */
export function ModeSelect({ value, onChange }: ModeSelectProps) {
  const hazard = value === 'prototype'

  return (
    <section
      className={`mode-select ${hazard ? 'mode-select-hazard' : ''}`}
      aria-label="Game mode"
    >
      <div className="mode-select-options">
        {VARIANTS.map((variant) => (
          <label
            key={variant}
            className={`mode-select-option ${
              value === variant ? 'mode-select-option-active' : ''
            }`}
          >
            <input
              type="radio"
              name="mode-select"
              value={variant}
              checked={value === variant}
              onChange={() => onChange(variant)}
            />
            <span className="mode-select-dot" aria-hidden="true" />
            <span className="mode-select-copy">
              <span className="mode-select-label">{VARIANT_LABELS[variant]}</span>
              <span className="mode-select-description">
                {VARIANT_DESCRIPTIONS[variant]}
              </span>
            </span>
            {variant === 'prototype' ? (
              <span className="mode-select-tag">UNDER DEVELOPMENT</span>
            ) : null}
          </label>
        ))}
      </div>
      {hazard ? (
        <p className="mode-select-warning" role="note">
          {PROTOTYPE_WARNING}
        </p>
      ) : null}
    </section>
  )
}
