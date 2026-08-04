import type { ButtonHTMLAttributes } from 'react'
import type { GameConfig } from '@hidden/game-core'
import type { AuthUser } from '../auth/authClient'
import { POWERUP_LABELS } from '../game/constants'

export type StatusTone = 'neutral' | 'working' | 'success' | 'error'

export interface UiStatus {
  tone: StatusTone
  label: string
  detail: string
}

interface GameMastheadProps {
  compact?: boolean
}

export function GameMasthead({ compact = false }: GameMastheadProps) {
  return (
    <h1 className={`game-title ${compact ? 'game-title-compact' : ''}`}>
      HIDDEN
    </h1>
  )
}

interface ActionChoiceProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  description: string
  badge?: string
  tone?: 'primary' | 'secondary'
}

export function ActionChoice({
  label,
  description,
  badge,
  tone = 'primary',
  className = '',
  type = 'button',
  ...props
}: ActionChoiceProps) {
  return (
    <button
      type={type}
      className={`action-choice action-choice-${tone} ${className}`}
      {...props}
    >
      <span className="action-choice-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
      {badge ? <small>{badge}</small> : null}
    </button>
  )
}

interface GuestIdentityProps {
  name: string
}

export function GuestIdentity({ name }: GuestIdentityProps) {
  return (
    <p className="guest-identity">
      <span>Playing as</span>
      <strong>{name}</strong>
    </p>
  )
}

export interface AdvancedSettingsProps {
  config: GameConfig
  onConfigChange: (patch: Partial<GameConfig>) => void
}

const BOARD_SIZES = [3, 4, 5] as const
const POWERUP_KEYS = ['shield', 'reveal', 'extraTurn'] as const

export function AdvancedSettings({
  config,
  onConfigChange,
}: AdvancedSettingsProps) {
  return (
    <details className="advanced-panel">
      <summary>Advanced</summary>
      <div className="advanced-grid">
        <label>
          <span>Rounds</span>
          <input
            type="number"
            min={1}
            max={20}
            value={config.rounds}
            onChange={(event) =>
              onConfigChange({ rounds: Math.max(1, Number(event.target.value) || 1) })
            }
          />
        </label>
        <label>
          <span>Timer</span>
          <input
            type="number"
            min={2}
            max={60}
            value={config.turnSeconds}
            onChange={(event) =>
              onConfigChange({
                turnSeconds: Math.max(2, Number(event.target.value) || 2),
              })
            }
          />
        </label>
        <div className="toggle-row">
          <span>Blind</span>
          <button
            type="button"
            className={`unity-toggle ${config.blindMode ? 'unity-toggle-on' : ''}`}
            aria-pressed={config.blindMode}
            onClick={() => onConfigChange({ blindMode: !config.blindMode })}
          >
            <span />
          </button>
        </div>
        <div className="toggle-row">
          <span>Board</span>
          <div className="board-size-choice">
            {BOARD_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={`unity-toggle ${config.boardSize === size ? 'unity-toggle-on' : ''}`}
                aria-pressed={config.boardSize === size}
                onClick={() =>
                  onConfigChange(
                    // A 5-streak is illegal on a 3x3, so shrink it with the board.
                    config.streak > size
                      ? { boardSize: size, streak: size }
                      : { boardSize: size },
                  )
                }
              >
                {size}x{size}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span>Line</span>
          <input
            type="number"
            min={2}
            max={config.boardSize}
            value={config.streak}
            onChange={(event) =>
              onConfigChange({ streak: Number(event.target.value) || 2 })
            }
          />
        </label>
        <div className="toggle-row">
          <span>Power-ups</span>
          <button
            type="button"
            className={`unity-toggle ${config.powerupsEnabled ? 'unity-toggle-on' : ''}`}
            aria-pressed={config.powerupsEnabled}
            onClick={() =>
              onConfigChange({ powerupsEnabled: !config.powerupsEnabled })
            }
          >
            <span />
          </button>
        </div>
        {config.powerupsEnabled
          ? POWERUP_KEYS.map((key) => (
              <div className="toggle-row" key={key}>
                <span>{POWERUP_LABELS[key]}</span>
                <button
                  type="button"
                  className={`unity-toggle ${config.powerups[key] ? 'unity-toggle-on' : ''}`}
                  aria-pressed={config.powerups[key]}
                  onClick={() =>
                    onConfigChange({
                      powerups: { ...config.powerups, [key]: !config.powerups[key] },
                    })
                  }
                >
                  <span />
                </button>
              </div>
            ))
          : null}
        <div className="toggle-row">
          <span>No repeat</span>
          <button
            type="button"
            className={`unity-toggle ${config.forbidImmediateRepeat ? 'unity-toggle-on' : ''}`}
            aria-pressed={config.forbidImmediateRepeat}
            onClick={() =>
              onConfigChange({
                forbidImmediateRepeat: !config.forbidImmediateRepeat,
              })
            }
          >
            <span />
          </button>
        </div>
      </div>
    </details>
  )
}

interface OnlineAdminSettingsProps extends AdvancedSettingsProps {
  user: AuthUser | null
}

export function OnlineAdminSettings({
  user,
  ...settings
}: OnlineAdminSettingsProps) {
  return user?.role === 'admin' ? <AdvancedSettings {...settings} /> : null
}

export function MatchRulesSummary({ config }: { config: GameConfig }) {
  return (
    <div className="match-rules-summary" aria-label="Match rules">
      <span>
        {config.boardSize}x{config.boardSize}
      </span>
      <span>{config.rounds} rounds</span>
      <span>{config.turnSeconds}s turns</span>
      <span>{config.blindMode ? 'Blind boards' : 'Open boards'}</span>
      <span>{config.powerupsEnabled ? 'Power-ups on' : 'Power-ups off'}</span>
    </div>
  )
}

interface StatusStripProps {
  status: UiStatus
  chrome?: boolean
}

export function StatusStrip({ status, chrome = false }: StatusStripProps) {
  const isError = status.tone === 'error'
  const isWorking = status.tone === 'working'

  return (
    <div
      className={`status-strip status-strip-${status.tone} ${
        chrome ? 'status-strip-chrome' : ''
      }`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={isWorking ? true : undefined}
    >
      <span className="status-indicator" aria-hidden="true" />
      <span className="status-copy">
        <span>{status.label}</span>
        <strong>{status.detail}</strong>
      </span>
    </div>
  )
}
