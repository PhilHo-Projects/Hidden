import {
  MAX_TURN_SECONDS,
  MIN_TURN_SECONDS,
  ONLINE_MIN_TURN_SECONDS,
  type BoardSize,
  type GameConfig,
  type PowerupKey,
} from '@hidden/game-core'
import { POWERUP_LABELS } from '../game/constants'

/*
 * Every configurable rule is declared here, and `AdvancedSettings` renders
 * whatever it finds. Adding, removing, or regrouping a rule is an edit to
 * `RULE_SECTIONS` alone; no markup or CSS changes with it.
 *
 * Bounds duplicate `clampGameConfig` in @hidden/game-core because the clamp
 * does not export them. `AdvancedSettings.test.ts` round-trips every field
 * through the clamp, so the two cannot drift apart unnoticed.
 */

export interface ChoiceOption {
  readonly value: number
  readonly label: string
  /** Rendered, but not selectable: the constraint stays visible. */
  readonly disabled?: boolean
}

interface FieldBase {
  readonly id: string
  readonly label: string
}

export interface ChoiceField extends FieldBase {
  readonly kind: 'choice'
  readonly options: (config: GameConfig) => readonly ChoiceOption[]
  readonly value: (config: GameConfig) => number
  readonly patch: (value: number, config: GameConfig) => Partial<GameConfig>
}

export interface NumberField extends FieldBase {
  readonly kind: 'number'
  readonly min: number
  readonly max: number
  readonly value: (config: GameConfig) => number
  readonly patch: (value: number, config: GameConfig) => Partial<GameConfig>
  /** Next value one press away. Defaults to whole units. */
  readonly step?: (value: number, direction: 1 | -1) => number
  /** Smallest typeable increment. Decides the on-screen keypad too. */
  readonly precision?: number
}

export interface FlagField extends FieldBase {
  readonly kind: 'flag'
  readonly value: (config: GameConfig) => boolean
  readonly patch: (value: boolean, config: GameConfig) => Partial<GameConfig>
  /** Sub-rules that only exist while this flag is on. */
  readonly children?: readonly FlagField[]
}

export type RuleField = ChoiceField | NumberField | FlagField

export interface RuleSection {
  readonly id: string
  readonly label?: string
  /** `pair` places two value controls per row; `flags` wraps toggle chips. */
  readonly layout: 'pair' | 'flags'
  readonly fields: readonly RuleField[]
}

const BOARD_SIZES: readonly BoardSize[] = [3, 4, 5]
const POWERUP_KEYS: readonly PowerupKey[] = ['shield', 'reveal', 'extraTurn']

const boardSize: ChoiceField = {
  kind: 'choice',
  id: 'boardSize',
  label: 'Board',
  options: () =>
    BOARD_SIZES.map((size) => ({ value: size, label: `${size} × ${size}` })),
  value: (config) => config.boardSize,
  // The line length is no longer a rule the player sets, so it rides the board:
  // a full row, column, or diagonal, whatever the board size.
  patch: (value) => ({ boardSize: value as BoardSize, streak: value }),
}

const rounds: NumberField = {
  kind: 'number',
  id: 'rounds',
  label: 'Rounds',
  min: 1,
  max: 20,
  value: (config) => config.rounds,
  patch: (value) => ({ rounds: value }),
}

/*
 * Whole seconds down to 1, then fifths of a second. Stepping the sub-second
 * range in whole seconds would skip it entirely, and stepping the whole range
 * in fifths would take forty presses to get from 10s to 0.2s.
 */
function stepTurnSeconds(value: number, direction: 1 | -1) {
  const size = direction < 0 ? (value <= 1 ? 0.2 : 1) : value < 1 ? 0.2 : 1
  return Math.round((value + direction * size) * 10) / 10
}

const turnSecondsField = (min: number): NumberField => ({
  kind: 'number',
  id: 'turnSeconds',
  label: 'Turn timer',
  min,
  max: MAX_TURN_SECONDS,
  value: (config) => config.turnSeconds,
  patch: (value) => ({ turnSeconds: value }),
  step: stepTurnSeconds,
  precision: 0.1,
})

const blindMode: FlagField = {
  kind: 'flag',
  id: 'blindMode',
  label: 'Blind',
  value: (config) => config.blindMode,
  patch: (value) => ({ blindMode: value }),
}

const powerupsEnabled: FlagField = {
  kind: 'flag',
  id: 'powerupsEnabled',
  label: 'Power-ups',
  value: (config) => config.powerupsEnabled,
  patch: (value) => ({ powerupsEnabled: value }),
  children: POWERUP_KEYS.map((key) => ({
    kind: 'flag' as const,
    id: `powerups.${key}`,
    label: POWERUP_LABELS[key],
    value: (config: GameConfig) => config.powerups[key],
    patch: (value: boolean, config: GameConfig) => ({
      powerups: { ...config.powerups, [key]: value },
    }),
  })),
}

const buildSections = (minTurnSeconds: number): readonly RuleSection[] => [
  { id: 'shape', layout: 'pair', fields: [boardSize] },
  { id: 'pace', layout: 'pair', fields: [rounds, turnSecondsField(minTurnSeconds)] },
  // Desecrated tiles are unconditional rather than a flag here: the rule exists
  // to stop a degenerate loop, so a match that can switch it off is not wanted.
  { id: 'rules', label: 'Rules', layout: 'flags', fields: [blindMode, powerupsEnabled] },
]

/** Offline practice. Sub-second turns make a bot match resolve in seconds. */
export const RULE_SECTIONS = buildSections(MIN_TURN_SECONDS)

/**
 * Hosting an online match. The server floors the turn timer at two seconds
 * regardless, so offering less here would only be a promise it breaks.
 */
export const ONLINE_RULE_SECTIONS = buildSections(ONLINE_MIN_TURN_SECONDS)
