import type { ClassicSymbol, GameVariant } from '@hidden/game-core'
import type { CubeView } from './cubeView'

export const COLOR_GREEN = '#6EDC3C' as const
export const COLOR_BLUE = '#4C6EF5' as const
export const COLOR_RED = '#DC2626' as const

/**
 * The symbol is the value; the colour is only how it is drawn. Presentation
 * state carries `ClassicSymbol` end to end and resolves a colour here at the
 * point of render, so a re-skin is a change to this table and nothing else.
 */
export const COLOR_BY_SYMBOL: Readonly<Record<ClassicSymbol, string>> = {
  rock: COLOR_GREEN,
  paper: COLOR_BLUE,
  scissors: COLOR_RED,
}

export const POWERUP_LABELS = {
  shield: 'Shield',
  reveal: 'Reveal',
  extraTurn: 'Extra Turn',
} as const

/** Placeholders. Neither mode has earned a real name yet. */
export const VARIANT_LABELS: Readonly<Record<GameVariant, string>> = {
  main: 'MAIN',
  prototype: 'PROTOTYPE',
}

export const VARIANT_DESCRIPTIONS: Readonly<Record<GameVariant, string>> = {
  main: 'The 3x3 game.',
  prototype: 'The cube experiment.',
}

export const PROTOTYPE_WARNING =
  'Incomplete. Expect bugs, and no winner is declared at the end.'

/**
 * The picker groups every work-in-progress mode under one entry, so the menu
 * does not grow a row per experiment. `VARIANT_LABELS.prototype` stays singular:
 * a match is one prototype, and that label is what badges and summaries show.
 */
export const PROTOTYPES_LABEL = 'PROTOTYPES'
export const PROTOTYPES_DESCRIPTION = 'Work-in-progress experiments.'

export const CUBE_VIEW_LABELS: Readonly<Record<CubeView, string>> = {
  flat: 'CUBE · FLAT',
  '3d': 'CUBE · 3D',
}

export const CUBE_VIEW_DESCRIPTIONS: Readonly<Record<CubeView, string>> = {
  flat: 'One face at a time, with the unfolded map.',
  '3d': 'A real cube you turn by quarters.',
}
