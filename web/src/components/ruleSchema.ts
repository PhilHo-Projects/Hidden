import type { BoardSize, GameConfig, PowerupKey } from '@hidden/game-core'
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
const LARGEST_BOARD = BOARD_SIZES[BOARD_SIZES.length - 1]
const POWERUP_KEYS: readonly PowerupKey[] = ['shield', 'reveal', 'extraTurn']

const boardSize: ChoiceField = {
  kind: 'choice',
  id: 'boardSize',
  label: 'Board',
  options: () =>
    BOARD_SIZES.map((size) => ({ value: size, label: `${size} × ${size}` })),
  value: (config) => config.boardSize,
  // A 5-line is illegal on a 3x3, so a shrinking board drags the line down with it.
  patch: (value, config) =>
    config.streak > value
      ? { boardSize: value as BoardSize, streak: value }
      : { boardSize: value as BoardSize },
}

const streak: ChoiceField = {
  kind: 'choice',
  id: 'streak',
  label: 'Line to win',
  options: (config) =>
    Array.from({ length: LARGEST_BOARD - 1 }, (_unused, index) => index + 2).map(
      (length) => ({
        value: length,
        label: String(length),
        disabled: length > config.boardSize,
      }),
    ),
  value: (config) => config.streak,
  patch: (value) => ({ streak: value }),
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

const turnSeconds: NumberField = {
  kind: 'number',
  id: 'turnSeconds',
  label: 'Turn timer',
  min: 2,
  max: 60,
  value: (config) => config.turnSeconds,
  patch: (value) => ({ turnSeconds: value }),
}

const blindMode: FlagField = {
  kind: 'flag',
  id: 'blindMode',
  label: 'Blind',
  value: (config) => config.blindMode,
  patch: (value) => ({ blindMode: value }),
}

const forbidImmediateRepeat: FlagField = {
  kind: 'flag',
  id: 'forbidImmediateRepeat',
  label: 'No repeat',
  value: (config) => config.forbidImmediateRepeat,
  patch: (value) => ({ forbidImmediateRepeat: value }),
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

export const RULE_SECTIONS: readonly RuleSection[] = [
  { id: 'shape', layout: 'pair', fields: [boardSize, streak] },
  { id: 'pace', layout: 'pair', fields: [rounds, turnSeconds] },
  { id: 'rules', label: 'Rules', layout: 'flags', fields: [blindMode, forbidImmediateRepeat, powerupsEnabled] },
]
