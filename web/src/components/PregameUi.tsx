import type { ButtonHTMLAttributes } from 'react'
import type { AuthUser } from '../auth/authClient'
import type { MatchRules } from '../game/matchRules'

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
  rounds: number
  turnSeconds: number
  blindMode: boolean
  onRoundsChange: (rounds: number) => void
  onTurnSecondsChange: (turnSeconds: number) => void
  onBlindModeChange: (blindMode: boolean) => void
}

export function AdvancedSettings({
  rounds,
  turnSeconds,
  blindMode,
  onRoundsChange,
  onTurnSecondsChange,
  onBlindModeChange,
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
            value={rounds}
            onChange={(event) =>
              onRoundsChange(Math.max(1, Number(event.target.value) || 1))
            }
          />
        </label>
        <label>
          <span>Timer</span>
          <input
            type="number"
            min={2}
            max={60}
            value={turnSeconds}
            onChange={(event) =>
              onTurnSecondsChange(Math.max(2, Number(event.target.value) || 2))
            }
          />
        </label>
        <div className="toggle-row">
          <span>Blind</span>
          <button
            type="button"
            className={`unity-toggle ${blindMode ? 'unity-toggle-on' : ''}`}
            aria-pressed={blindMode}
            onClick={() => onBlindModeChange(!blindMode)}
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

export function MatchRulesSummary({ rules }: { rules: MatchRules }) {
  return (
    <div className="match-rules-summary" aria-label="Match rules">
      <span>{rules.rounds} rounds</span>
      <span>{rules.turnSeconds}s turns</span>
      <span>{rules.blindMode ? 'Blind boards' : 'Open boards'}</span>
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
