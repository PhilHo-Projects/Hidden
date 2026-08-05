import type { ButtonHTMLAttributes } from 'react'
import type { GameConfig } from '@hidden/game-core'
import type { AuthUser } from '../auth/authClient'
import { RuleFlag, RuleSegments, RuleStepper } from './RuleControls'
import {
  RULE_SECTIONS,
  type FlagField,
  type RuleField,
  type RuleSection,
} from './ruleSchema'

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
  /** Defaults to the shipped rules; overridable so a caller can stage new ones. */
  sections?: readonly RuleSection[]
}

function RuleFlags({
  fields,
  config,
  onConfigChange,
}: {
  fields: readonly RuleField[]
  config: GameConfig
  onConfigChange: (patch: Partial<GameConfig>) => void
}) {
  const flags = fields.filter((field): field is FlagField => field.kind === 'flag')

  return (
    <>
      <div className="rule-chips">
        {flags.map((field) => (
          <RuleFlag
            key={field.id}
            field={field}
            config={config}
            onConfigChange={onConfigChange}
          />
        ))}
      </div>
      {/*
       * Sub-rules render below the whole row rather than beside their parent, so
       * a parent added in the middle of a group cannot split the row in half.
       */}
      {flags
        .filter((field) => field.children?.length && field.value(config))
        .map((parent) => (
          <div
            key={parent.id}
            className="rule-chips rule-chips-nested"
            role="group"
            aria-label={`${parent.label} options`}
          >
            {parent.children?.map((child) => (
              <RuleFlag
                key={child.id}
                field={child}
                config={config}
                onConfigChange={onConfigChange}
              />
            ))}
          </div>
        ))}
    </>
  )
}

export function AdvancedSettings({
  config,
  onConfigChange,
  sections = RULE_SECTIONS,
}: AdvancedSettingsProps) {
  return (
    <details className="advanced-panel">
      <summary>Advanced</summary>
      <div className="rule-sections">
        {sections.map((section) => (
          <section key={section.id} className="rule-section">
            {section.label ? (
              <h3 className="rule-section-label">{section.label}</h3>
            ) : null}
            {section.layout === 'flags' ? (
              <RuleFlags
                fields={section.fields}
                config={config}
                onConfigChange={onConfigChange}
              />
            ) : (
              <div className="rule-pair">
                {section.fields.map((field) =>
                  field.kind === 'choice' ? (
                    <RuleSegments
                      key={field.id}
                      field={field}
                      config={config}
                      onConfigChange={onConfigChange}
                    />
                  ) : field.kind === 'number' ? (
                    <RuleStepper
                      key={field.id}
                      field={field}
                      config={config}
                      onConfigChange={onConfigChange}
                    />
                  ) : null,
                )}
              </div>
            )}
          </section>
        ))}
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
