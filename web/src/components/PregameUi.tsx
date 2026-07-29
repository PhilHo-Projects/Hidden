import type { ButtonHTMLAttributes } from 'react'

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
