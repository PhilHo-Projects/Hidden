import type { GameConfig } from '@hidden/game-core'
import type { ChoiceField, FlagField, NumberField, RuleField } from './ruleSchema'

/*
 * Three controls cover every rule the schema can declare: pick-one, a bounded
 * number, and on/off. Keeping the vocabulary this small is what lets a new rule
 * arrive as data instead of as markup.
 */

interface ControlProps<Field extends RuleField> {
  field: Field
  config: GameConfig
  onConfigChange: (patch: Partial<GameConfig>) => void
}

export function RuleSegments({ field, config, onConfigChange }: ControlProps<ChoiceField>) {
  const selected = field.value(config)

  return (
    <fieldset className="rule-field" data-rule={field.id} role="radiogroup">
      <legend className="rule-label">{field.label}</legend>
      <div className="rule-segments">
        {field.options(config).map((option) => (
          <label
            key={option.value}
            className="rule-segment"
            data-selected={option.value === selected || undefined}
          >
            <input
              className="rule-segment-input"
              type="radio"
              name={`rule-${field.id}`}
              value={option.value}
              checked={option.value === selected}
              disabled={option.disabled}
              onChange={() => onConfigChange(field.patch(option.value, config))}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function RuleStepper({ field, config, onConfigChange }: ControlProps<NumberField>) {
  const value = field.value(config)
  const inputId = `rule-${field.id}`
  // The clamp in game-core is the guard; clamping here keeps the typed value
  // from bouncing back at the user without explanation.
  const commit = (next: number) =>
    onConfigChange(field.patch(Math.min(field.max, Math.max(field.min, next)), config))
  // A field without its own step moves in whole units, which is what every
  // rule but the turn timer wants.
  const stepTo = (direction: 1 | -1) =>
    field.step ? field.step(value, direction) : value + direction

  return (
    <div className="rule-field" data-rule={field.id}>
      <label className="rule-label" htmlFor={inputId}>
        {field.label}
      </label>
      <div className="rule-stepper">
        <button
          type="button"
          className="rule-step"
          aria-label={`Decrease ${field.label}`}
          disabled={value <= field.min}
          onClick={() => commit(stepTo(-1))}
        >
          −
        </button>
        <input
          id={inputId}
          className="rule-number"
          type="number"
          inputMode={field.precision ? 'decimal' : 'numeric'}
          step={field.precision ?? 1}
          min={field.min}
          max={field.max}
          value={value}
          onChange={(event) => commit(Number(event.target.value) || field.min)}
        />
        <button
          type="button"
          className="rule-step"
          aria-label={`Increase ${field.label}`}
          disabled={value >= field.max}
          onClick={() => commit(stepTo(1))}
        >
          +
        </button>
      </div>
    </div>
  )
}

interface RuleChipProps {
  id: string
  label: string
  pressed: boolean
  onToggle: () => void
}

/*
 * Shared with the private-room toggle in App.tsx, which is not a GameConfig
 * rule but must not invent a second on/off affordance for the same screen.
 */
export function RuleChip({ id, label, pressed, onToggle }: RuleChipProps) {
  return (
    <button
      type="button"
      className="rule-chip"
      data-rule={id}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      <span className="rule-chip-dot" aria-hidden="true" />
      {label}
    </button>
  )
}

export function RuleFlag({ field, config, onConfigChange }: ControlProps<FlagField>) {
  const pressed = field.value(config)

  return (
    <RuleChip
      id={field.id}
      label={field.label}
      pressed={pressed}
      onToggle={() => onConfigChange(field.patch(!pressed, config))}
    />
  )
}
