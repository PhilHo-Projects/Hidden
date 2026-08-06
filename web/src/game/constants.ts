import type { ClassicSymbol } from '@hidden/game-core'

export const COLOR_GREEN = '#A6E22E' as const
export const COLOR_BLUE = '#4591DB' as const
export const COLOR_RED = '#CC3941' as const

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
