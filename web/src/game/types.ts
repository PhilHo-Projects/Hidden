import type { PLAYER_COLORS, POWERUP_LABELS } from './constants'
import type {
  GameConfig,
  GameState as CoreGameState,
  Seat,
} from '@hidden/game-core'

export type PaintColor = (typeof PLAYER_COLORS)[number]
export type PowerupKey = keyof typeof POWERUP_LABELS
export type MatchPhase = 'setup' | 'battle' | 'results'

export interface CellState {
  occupied: boolean
  color: PaintColor | null
  immune: boolean
}

export interface GridState {
  cells: CellState[]
}

export interface PowerupState {
  unlocked: Record<PowerupKey, boolean>
  used: Record<PowerupKey, boolean>
  revealActive: boolean
  extraTurnArmed: boolean
}

// Every rule knob lives in GameConfig; MatchConfig only adds how the match is
// being played, which the core neither knows nor cares about.
export interface MatchConfig extends GameConfig {
  isOnline: boolean
  hasAI: boolean
}

export interface QueuedMove {
  index: number
  color: PaintColor
}

export interface MatchResult {
  playerScore: number
  opponentScore: number
  outcome: 'win' | 'loss' | 'tie'
}

export interface GameState {
  config: MatchConfig
  phase: MatchPhase
  playerGrid: GridState
  opponentGrid: GridState
  isMyTurn: boolean
  currentRound: number
  totalTurns: number
  maxTurns: number
  selectedColor: PaintColor | null
  shieldSelectionMode: boolean
  playerPowerups: PowerupState
  pendingExtraTurnMoves: QueuedMove[]
  isInExtraTurn: boolean
  result: MatchResult | null
  canonicalState?: CoreGameState
  localSeat?: Seat
}

export type EngineEvent =
  | { type: 'announcement'; message: string }
  | { type: 'cell-destroyed'; board: 'player' | 'opponent'; index: number; color: PaintColor }
  | { type: 'game-over'; result: MatchResult }

export interface EngineResult {
  state: GameState
  events: EngineEvent[]
}

export type RandomFn = () => number
