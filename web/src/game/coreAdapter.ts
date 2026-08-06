import {
  applyCommand,
  applyTimeout,
  createGame,
  ENGINE_ID,
  ENGINE_REVISION,
  type ApplyResult as CoreApplyResult,
  type ClassicSymbol,
  type DomainEvent,
  type GameState as CoreGameState,
  type Seat,
} from '@hidden/game-core'

import { COLOR_BLUE, COLOR_GREEN, COLOR_RED } from './constants'
import type {
  EngineEvent,
  EngineResult,
  GameState,
  MatchConfig,
  MatchResult,
  PaintColor,
  PowerupKey,
  PowerupState,
} from './types'

const colorBySymbol: Record<ClassicSymbol, PaintColor> = {
  rock: COLOR_GREEN,
  paper: COLOR_BLUE,
  scissors: COLOR_RED,
}

const symbolByColor: Record<PaintColor, ClassicSymbol> = {
  [COLOR_GREEN]: 'rock',
  [COLOR_BLUE]: 'paper',
  [COLOR_RED]: 'scissors',
}

const unlockMessages: Record<PowerupKey, string> = {
  shield: 'Shield unlocked!',
  reveal: 'Reveal unlocked!',
  extraTurn: 'Extra turn unlocked!',
}

function opponentOf(seat: Seat): Seat {
  return (1 - seat) as Seat
}

function presentPowerups(state: CoreGameState, seat: Seat): PowerupState {
  const powerups = state.powerups[seat]
  return {
    unlocked: { ...powerups.unlocked },
    used: { ...powerups.used },
    revealActive: powerups.revealActive,
    extraTurnArmed: powerups.extraTurnArmed,
  }
}

function presentGrid(state: CoreGameState, seat: Seat) {
  return {
    cells: state.boards[seat].locations.map((location) => ({
      occupied: location.symbol !== null,
      color: location.symbol ? colorBySymbol[location.symbol] : null,
      immune: location.immune,
    })),
  }
}

function presentResult(state: CoreGameState, localSeat: Seat): MatchResult | null {
  if (!state.result) return null
  const opponentSeat = opponentOf(localSeat)
  const playerScore = state.result.scores[localSeat]
  const opponentScore = state.result.scores[opponentSeat]
  return {
    playerScore,
    opponentScore,
    outcome:
      state.result.winner === null
        ? 'tie'
        : state.result.winner === localSeat
          ? 'win'
          : 'loss',
  }
}

function presentState(
  canonicalState: CoreGameState,
  previous: GameState,
  overrides: Partial<Pick<GameState, 'phase' | 'selectedColor'>> = {},
): GameState {
  const localSeat = previous.localSeat ?? 0
  const opponentSeat = opponentOf(localSeat)
  return {
    ...previous,
    phase: canonicalState.phase === 'finished' ? 'results' : previous.phase,
    playerGrid: presentGrid(canonicalState, localSeat),
    opponentGrid: presentGrid(canonicalState, opponentSeat),
    isMyTurn: canonicalState.phase === 'active' && canonicalState.activeSeat === localSeat,
    currentRound: canonicalState.currentRound,
    totalTurns: canonicalState.turnCount,
    maxTurns: canonicalState.maxTurns,
    shieldSelectionMode: canonicalState.powerups[localSeat].shieldSelectionPending,
    playerPowerups: presentPowerups(canonicalState, localSeat),
    pendingExtraTurnMoves: canonicalState.pendingExtraPlacements.map((placement) => ({
      index: placement.locationId,
      color: colorBySymbol[placement.symbol],
    })),
    isInExtraTurn: canonicalState.powerups[localSeat].extraTurnInProgress,
    result: presentResult(canonicalState, localSeat),
    canonicalState,
    localSeat,
    ...overrides,
  }
}

function gameOverEvent(state: CoreGameState, localSeat: Seat): EngineEvent {
  const result = presentResult(state, localSeat)
  if (!result) throw new Error('A finished canonical game must have a result.')
  return { type: 'game-over', result }
}

function presentEvent(
  event: DomainEvent,
  state: CoreGameState,
  localSeat: Seat,
): EngineEvent[] {
  switch (event.type) {
    case 'timeout':
      return [{ type: 'announcement', message: 'Timer expired!' }]
    case 'cell-destroyed':
      return [{
        type: 'cell-destroyed',
        board: event.seat === localSeat ? 'player' : 'opponent',
        index: event.locationId,
        color: colorBySymbol[event.symbol],
      }]
    case 'shield-protected':
      return [{
        type: 'announcement',
        message: event.seat === localSeat
          ? 'Your piece was protected!'
          : "Opponent's piece was protected!",
      }]
    case 'powerup-unlocked':
      return event.seat === localSeat
        ? [{ type: 'announcement', message: unlockMessages[event.powerup] }]
        : []
    case 'powerup-activated':
      if (event.seat !== localSeat) return []
      return [{
        type: 'announcement',
        message:
          event.powerup === 'shield'
            ? 'Shield used'
            : event.powerup === 'reveal'
              ? 'Reveal board used'
              : 'Extra turn activated!',
      }]
    case 'shield-selected':
      return event.seat === localSeat
        ? [{ type: 'announcement', message: 'Piece shielded!' }]
        : []
    case 'extra-turn-started':
      return event.seat === localSeat
        ? [{ type: 'announcement', message: 'Extra turn!' }]
        : []
    case 'turn-passed':
      return [{
        type: 'announcement',
        message: event.seat === localSeat ? 'Turn passed!' : 'Opponent passed!',
      }]
    case 'game-finished':
      return [gameOverEvent(state, localSeat)]
    case 'placements-committed':
      return []
  }
}

function rejectionEvents(result: CoreApplyResult): EngineEvent[] {
  if (result.accepted) return []
  if (result.rejection?.reason === 'location-occupied') {
    return [{ type: 'announcement', message: 'Spot taken!' }]
  }
  if (result.rejection?.reason === 'invalid-shield-target') {
    return [{ type: 'announcement', message: 'Can only shield your pieces!' }]
  }
  return []
}

function presentResultFromCore(
  previous: GameState,
  result: CoreApplyResult,
  options: { clearSelection?: boolean; suppressTimeoutAnnouncement?: boolean } = {},
): EngineResult {
  const localSeat = previous.localSeat ?? 0
  const state = result.accepted
    ? presentState(result.state, previous, {
        selectedColor: options.clearSelection ? null : previous.selectedColor,
      })
    : previous
  const domainEvents = options.suppressTimeoutAnnouncement
    ? result.events.filter((event) => event.type !== 'timeout')
    : result.events
  return {
    state,
    events: result.accepted
      ? domainEvents.flatMap((event) => presentEvent(event, result.state, localSeat))
      : rejectionEvents(result),
  }
}

function requireCanonical(state: GameState) {
  if (!state.canonicalState || state.localSeat === undefined) {
    throw new Error('Offline core state is unavailable.')
  }
  return { canonicalState: state.canonicalState, localSeat: state.localSeat }
}

export function createOfflineState(
  config: MatchConfig,
  isMyTurn: boolean,
  seed: number,
): GameState {
  const localSeat: Seat = 0
  const canonicalState = createGame({
    engine: { id: ENGINE_ID, revision: ENGINE_REVISION },
    // MatchConfig structurally satisfies GameConfig; the two extra transport
    // fields are ignored by the clamp.
    config,
    seed,
    firstSeat: isMyTurn ? localSeat : opponentOf(localSeat),
  })
  const base: GameState = {
    config,
    phase: 'setup',
    playerGrid: { cells: [] },
    opponentGrid: { cells: [] },
    isMyTurn,
    currentRound: 1,
    totalTurns: 0,
    maxTurns: canonicalState.maxTurns,
    selectedColor: null,
    shieldSelectionMode: false,
    playerPowerups: presentPowerups(canonicalState, localSeat),
    pendingExtraTurnMoves: [],
    isInExtraTurn: false,
    result: null,
    canonicalState,
    localSeat,
  }
  return presentState(canonicalState, base)
}

export function createOnlinePresentedState(
  config: MatchConfig,
  canonicalState: CoreGameState,
  localSeat: Seat,
): GameState {
  const base: GameState = {
    config,
    phase: 'setup',
    playerGrid: { cells: [] },
    opponentGrid: { cells: [] },
    isMyTurn: canonicalState.activeSeat === localSeat,
    currentRound: canonicalState.currentRound,
    totalTurns: canonicalState.turnCount,
    maxTurns: canonicalState.maxTurns,
    selectedColor: null,
    shieldSelectionMode: false,
    playerPowerups: presentPowerups(canonicalState, localSeat),
    pendingExtraTurnMoves: [],
    isInExtraTurn: false,
    result: null,
    canonicalState,
    localSeat,
  }
  return presentState(canonicalState, base)
}

export function applyOnlinePresentation(
  previous: GameState,
  canonicalState: CoreGameState,
  events: readonly DomainEvent[],
  clearSelection = false,
): EngineResult {
  const localSeat = previous.localSeat ?? 0
  return {
    state: presentState(canonicalState, previous, {
      selectedColor: clearSelection ? null : previous.selectedColor,
    }),
    events: events.flatMap((event) =>
      presentEvent(event, canonicalState, localSeat),
    ),
  }
}

export function startOfflineMatch(state: GameState): EngineResult {
  const { canonicalState, localSeat } = requireCanonical(state)
  return {
    state: presentState(canonicalState, state, { phase: 'battle' }),
    events: [{
      type: 'announcement',
      message: canonicalState.activeSeat === localSeat ? 'You start!' : 'Waiting...',
    }],
  }
}

/**
 * Arms the next placement with a colour. A shallow copy is enough: every other
 * function here rebuilds the grids from canonical state rather than mutating
 * them, so the sharing this leaves behind is never written through.
 */
export function selectColor(state: GameState, color: PaintColor): GameState {
  return { ...state, selectedColor: color }
}

export function applyOfflineLocalMove(
  state: GameState,
  index: number,
  overrideColor?: PaintColor,
): EngineResult {
  const { canonicalState, localSeat } = requireCanonical(state)
  const color = overrideColor ?? state.selectedColor
  if (!color) return { state, events: [] }
  return presentResultFromCore(
    state,
    applyCommand(canonicalState, localSeat, {
      type: 'place',
      locationId: index,
      symbol: symbolByColor[color],
    }),
    { clearSelection: true },
  )
}

export function applyOfflineBotMove(
  state: GameState,
  index: number,
  color: PaintColor,
): EngineResult {
  const { canonicalState, localSeat } = requireCanonical(state)
  return presentResultFromCore(
    state,
    applyCommand(canonicalState, opponentOf(localSeat), {
      type: 'place',
      locationId: index,
      symbol: symbolByColor[color],
    }),
  )
}

export function applyOfflinePowerup(
  state: GameState,
  powerup: PowerupKey,
): EngineResult {
  const { canonicalState, localSeat } = requireCanonical(state)
  return presentResultFromCore(
    state,
    applyCommand(canonicalState, localSeat, { type: 'activate-powerup', powerup }),
  )
}

export function applyOfflineShieldSelection(
  state: GameState,
  index: number,
): EngineResult {
  const { canonicalState, localSeat } = requireCanonical(state)
  return presentResultFromCore(
    state,
    applyCommand(canonicalState, localSeat, {
      type: 'select-shield-target',
      locationId: index,
    }),
  )
}

export function forceOfflineTimeout(state: GameState): EngineResult {
  const { canonicalState } = requireCanonical(state)
  return presentResultFromCore(state, applyTimeout(canonicalState), { clearSelection: true })
}

export function playOfflineBotTurn(state: GameState): EngineResult {
  const { canonicalState } = requireCanonical(state)
  return presentResultFromCore(state, applyTimeout(canonicalState), {
    suppressTimeoutAnnouncement: true,
  })
}
