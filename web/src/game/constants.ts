export const COLOR_GREEN = '#A6E22E' as const
export const COLOR_BLUE = '#4591DB' as const
export const COLOR_RED = '#CC3941' as const

export const PLAYER_COLORS = [COLOR_GREEN, COLOR_BLUE, COLOR_RED] as const

export const POWERUP_BY_COLOR = {
  [COLOR_GREEN]: 'shield',
  [COLOR_BLUE]: 'reveal',
  [COLOR_RED]: 'extraTurn',
} as const

export const POWERUP_LABELS = {
  shield: 'Shield',
  reveal: 'Reveal',
  extraTurn: 'Extra Turn',
} as const

export const POWERUP_MESSAGES = {
  shield: 'Shield unlocked!',
  reveal: 'Reveal unlocked!',
  extraTurn: 'Extra turn unlocked!',
} as const

export const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const
