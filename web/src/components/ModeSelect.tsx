import '../prototype-mode.css'
import {
  CUBE_VIEW_DESCRIPTIONS,
  CUBE_VIEW_LABELS,
  PROTOTYPES_DESCRIPTION,
  PROTOTYPES_LABEL,
  PROTOTYPE_WARNING,
  VARIANT_DESCRIPTIONS,
  VARIANT_LABELS,
} from '../game/constants'
import { CUBE_VIEWS, type CubeView } from '../game/cubeView'
import type { GameVariant } from '@hidden/game-core'

const VARIANTS: readonly GameVariant[] = ['main', 'prototype']

// The prototype option names the group, not one experiment inside it.
const OPTION_COPY: Readonly<Record<GameVariant, { label: string; description: string }>> = {
  main: { label: VARIANT_LABELS.main, description: VARIANT_DESCRIPTIONS.main },
  prototype: { label: PROTOTYPES_LABEL, description: PROTOTYPES_DESCRIPTION },
}

interface ModeSelectProps {
  value: GameVariant
  /** Which way the cube prototype is drawn. Only offered under PROTOTYPES. */
  view: CubeView
  onChange: (variant: GameVariant) => void
  onViewChange: (view: CubeView) => void
}

/**
 * Picks which game a match will be, and for the prototypes, how it is drawn.
 *
 * Switching modes replaces the whole config rather than patching one field --
 * see `defaultConfigForVariant`. A 5x5 board tuned for `main` is not something
 * `prototype` can honour, so carrying settings across would only produce a
 * config the clamp silently rewrites. Both cube views play the same `prototype`
 * match; the view is a client-only preference and never reaches the config.
 *
 * Selecting the prototypes recolours the control red rather than the system's
 * usual yellow. Yellow everywhere else in Hidden means "selected, and fine";
 * this mode is not fine, and making the control itself carry the hazard is what
 * stops it being entered by accident.
 *
 * The two modes stack rather than sitting side by side, and the views open
 * nested under PROTOTYPES rather than beside it. Side by side claimed the two
 * were the same kind of choice; they are not. MAIN is a game, PROTOTYPES is a
 * drawer, and what is in the drawer belongs to it.
 */
export function ModeSelect({ value, view, onChange, onViewChange }: ModeSelectProps) {
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
            className={`mode-select-option mode-select-option-${variant} ${
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
              <span className="mode-select-label">{OPTION_COPY[variant].label}</span>
              <span className="mode-select-description">
                {OPTION_COPY[variant].description}
              </span>
            </span>
            {variant === 'prototype' ? (
              <span className="mode-select-tag">UNDER DEVELOPMENT</span>
            ) : null}
          </label>
        ))}
      </div>
      {hazard ? (
        <div className="mode-select-nest">
          <div className="mode-select-views" role="radiogroup" aria-label="Prototype">
            {CUBE_VIEWS.map((option) => (
              <label
                key={option}
                className={`mode-select-view ${view === option ? 'mode-select-view-active' : ''}`}
              >
                <input
                  type="radio"
                  name="cube-view"
                  value={option}
                  checked={view === option}
                  onChange={() => onViewChange(option)}
                />
                <span className="mode-select-copy">
                  <span className="mode-select-label">{CUBE_VIEW_LABELS[option]}</span>
                  <span className="mode-select-description">
                    {CUBE_VIEW_DESCRIPTIONS[option]}
                  </span>
                </span>
                <span className="mode-select-view-tag">WIP</span>
              </label>
            ))}
          </div>
          <p className="mode-select-warning" role="note">
            {PROTOTYPE_WARNING}
          </p>
        </div>
      ) : null}
    </section>
  )
}
