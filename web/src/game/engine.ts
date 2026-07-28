import {
  COLOR_BLUE,
  COLOR_GREEN,
  COLOR_RED,
  PLAYER_COLORS,
  POWERUP_BY_COLOR,
  POWERUP_MESSAGES,
  WIN_LINES,
} from './constants'
import type {
  CellState,
  EngineEvent,
  EngineResult,
  GridState,
  GameState,
  MatchConfig,
  MatchResult,
  PaintColor,
  PowerupKey,
  PowerupState,
  QueuedMove,
  RandomFn,
} from './types'

function createCell(): CellState {
  return {
    occupied: false,
    color: null,
    immune: false,
  }
}

function createGrid(): GridState {
  return {
    cells: Array.from({ length: 9 }, createCell),
  }
}

function createPowerups(): PowerupState {
  return {
    unlocked: {
      shield: false,
      reveal: false,
      extraTurn: false,
    },
    used: {
      shield: false,
      reveal: false,
      extraTurn: false,
    },
    revealActive: false,
    extraTurnArmed: false,
  }
}

function cloneGrid(grid: GridState): GridState {
  return {
    cells: grid.cells.map((cell) => ({ ...cell })),
  }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    playerGrid: cloneGrid(state.playerGrid),
    opponentGrid: cloneGrid(state.opponentGrid),
    playerPowerups: {
      unlocked: { ...state.playerPowerups.unlocked },
      used: { ...state.playerPowerups.used },
      revealActive: state.playerPowerups.revealActive,
      extraTurnArmed: state.playerPowerups.extraTurnArmed,
    },
    pendingExtraTurnMoves: state.pendingExtraTurnMoves.map((move) => ({ ...move })),
    result: state.result ? { ...state.result } : null,
  }
}

function createAnnouncement(message: string): EngineEvent {
  return { type: 'announcement', message }
}

function clearCell(grid: GridState, index: number) {
  grid.cells[index] = createCell()
}

function getCurrentRound(totalTurns: number, rounds: number) {
  return Math.min(rounds, Math.floor(totalTurns / 2) + 1)
}

function countOccupiedCells(grid: GridState) {
  return grid.cells.reduce((total, cell) => total + Number(cell.occupied), 0)
}

function createMatchResult(state: GameState): MatchResult {
  const playerScore = countOccupiedCells(state.playerGrid)
  const opponentScore = countOccupiedCells(state.opponentGrid)

  return {
    playerScore,
    opponentScore,
    outcome:
      playerScore === opponentScore
        ? 'tie'
        : playerScore > opponentScore
          ? 'win'
          : 'loss',
  }
}

function finishMatch(state: GameState, events: EngineEvent[]) {
  state.phase = 'results'
  state.playerPowerups.revealActive = true
  state.result = createMatchResult(state)
  events.push({ type: 'game-over', result: state.result })
}

function resolveComparison(playerColor: PaintColor, opponentColor: PaintColor) {
  if (playerColor === opponentColor) {
    return { clearPlayer: true, clearOpponent: true }
  }

  switch (playerColor) {
    case COLOR_GREEN:
      return {
        clearPlayer: opponentColor === COLOR_BLUE,
        clearOpponent: opponentColor === COLOR_RED,
      }
    case COLOR_BLUE:
      return {
        clearPlayer: opponentColor === COLOR_RED,
        clearOpponent: opponentColor === COLOR_GREEN,
      }
    case COLOR_RED:
      return {
        clearPlayer: opponentColor === COLOR_GREEN,
        clearOpponent: opponentColor === COLOR_BLUE,
      }
  }
}

function handleImmunity(
  defenderGrid: GridState,
  attackerGrid: GridState,
  index: number,
  protectedMessage: string,
  shouldClear: boolean,
  events: EngineEvent[],
) {
  if (!shouldClear) {
    return false
  }

  if (!defenderGrid.cells[index].immune) {
    return true
  }

  defenderGrid.cells[index].immune = false
  clearCell(attackerGrid, index)
  events.push(createAnnouncement(protectedMessage))
  return false
}

function resolveConflict(state: GameState, index: number, events: EngineEvent[]) {
  const playerColor = state.playerGrid.cells[index].color
  const opponentColor = state.opponentGrid.cells[index].color

  if (!playerColor || !opponentColor) {
    return
  }

  const comparison = resolveComparison(playerColor, opponentColor)
  const shouldClearPlayer = handleImmunity(
    state.playerGrid,
    state.opponentGrid,
    index,
    'Your piece was protected!',
    comparison.clearPlayer,
    events,
  )
  const shouldClearOpponent = handleImmunity(
    state.opponentGrid,
    state.playerGrid,
    index,
    "Opponent's piece was protected!",
    comparison.clearOpponent,
    events,
  )

  if (shouldClearPlayer) {
    clearCell(state.playerGrid, index)
  }

  if (shouldClearOpponent) {
    clearCell(state.opponentGrid, index)
  }
}

function maybeUnlockPowerup(state: GameState, events: EngineEvent[]) {
  for (const [a, b, c] of WIN_LINES) {
    const first = state.playerGrid.cells[a]
    const second = state.playerGrid.cells[b]
    const third = state.playerGrid.cells[c]

    if (!first.occupied || !second.occupied || !third.occupied) {
      continue
    }

    if (first.color !== second.color || second.color !== third.color || !first.color) {
      continue
    }

    const powerup = POWERUP_BY_COLOR[first.color]
    if (state.playerPowerups.unlocked[powerup]) {
      continue
    }

    state.playerPowerups.unlocked[powerup] = true
    events.push(createAnnouncement(POWERUP_MESSAGES[powerup]))
    return
  }
}

function queueExtraTurnMove(state: GameState, move: QueuedMove) {
  if (state.isInExtraTurn) {
    state.pendingExtraTurnMoves.push(move)
    return
  }

  state.pendingExtraTurnMoves = [move]
}

function transitionTurn(state: GameState) {
  state.isMyTurn = !state.isMyTurn
  state.currentRound = getCurrentRound(state.totalTurns, state.config.rounds)
}

function pickRandomIndex(indexes: number[], random: RandomFn) {
  return indexes[Math.floor(random() * indexes.length)]
}

function pickRandomColor(random: RandomFn): PaintColor {
  return PLAYER_COLORS[Math.floor(random() * PLAYER_COLORS.length)] as PaintColor
}

export function createInitialState(config: MatchConfig): GameState {
  return {
    config,
    phase: 'setup',
    playerGrid: createGrid(),
    opponentGrid: createGrid(),
    isMyTurn: true,
    currentRound: 1,
    totalTurns: 0,
    maxTurns: config.rounds * 2,
    selectedColor: null,
    shieldSelectionMode: false,
    playerPowerups: createPowerups(),
    pendingExtraTurnMoves: [],
    isInExtraTurn: false,
    result: null,
  }
}

export function startMatch(state: GameState, isMyTurn: boolean): EngineResult {
  const nextState = cloneState(state)
  nextState.phase = 'battle'
  nextState.isMyTurn = isMyTurn
  nextState.currentRound = 1

  return {
    state: nextState,
    events: [createAnnouncement(isMyTurn ? 'You start!' : 'Waiting...')],
  }
}

export function selectColor(state: GameState, color: PaintColor): GameState {
  const nextState = cloneState(state)
  nextState.selectedColor = color
  return nextState
}

export function activatePowerup(state: GameState, powerup: PowerupKey): EngineResult {
  const nextState = cloneState(state)
  const events: EngineEvent[] = []

  if (!nextState.isMyTurn) {
    return { state: nextState, events }
  }

  if (!nextState.playerPowerups.unlocked[powerup] || nextState.playerPowerups.used[powerup]) {
    return { state: nextState, events }
  }

  nextState.playerPowerups.used[powerup] = true

  switch (powerup) {
    case 'shield':
      nextState.shieldSelectionMode = true
      events.push(createAnnouncement('Shield used'))
      break
    case 'reveal':
      nextState.playerPowerups.revealActive = true
      events.push(createAnnouncement('Reveal board used'))
      break
    case 'extraTurn':
      nextState.playerPowerups.extraTurnArmed = true
      events.push(createAnnouncement('Extra turn activated!'))
      break
  }

  return { state: nextState, events }
}

export function applyShieldSelection(state: GameState, index: number): EngineResult {
  const nextState = cloneState(state)
  const events: EngineEvent[] = []
  const cell = nextState.playerGrid.cells[index]

  if (!cell.occupied || !cell.color) {
    events.push(createAnnouncement('Can only shield your pieces!'))
    return { state: nextState, events }
  }

  cell.immune = true
  nextState.shieldSelectionMode = false
  events.push(createAnnouncement('Piece shielded!'))

  if (nextState.config.isOnline) {
    events.push({ type: 'send-immune', indices: [index] })
  }

  return { state: nextState, events }
}

export function applyLocalMove(
  state: GameState,
  index: number,
  overrideColor?: PaintColor,
): EngineResult {
  const nextState = cloneState(state)
  const events: EngineEvent[] = []
  const selectedColor = overrideColor ?? nextState.selectedColor

  if (!nextState.isMyTurn || !selectedColor) {
    return { state: nextState, events }
  }

  if (nextState.playerGrid.cells[index].occupied) {
    events.push(createAnnouncement('Spot taken!'))
    return { state: nextState, events }
  }

  nextState.playerGrid.cells[index] = {
    occupied: true,
    color: selectedColor,
    immune: nextState.playerGrid.cells[index].immune,
  }
  nextState.playerPowerups.revealActive = false
  nextState.selectedColor = null

  if (nextState.opponentGrid.cells[index].occupied) {
    resolveConflict(nextState, index, events)
  }

  queueExtraTurnMove(nextState, { index, color: selectedColor })
  maybeUnlockPowerup(nextState, events)

  if (nextState.playerPowerups.extraTurnArmed) {
    nextState.playerPowerups.extraTurnArmed = false
    nextState.isInExtraTurn = true
    events.push(createAnnouncement('Extra turn!'))
    return { state: nextState, events }
  }

  if (nextState.config.isOnline) {
    if (nextState.isInExtraTurn) {
      events.push({ type: 'send-moves', moves: nextState.pendingExtraTurnMoves })
      nextState.pendingExtraTurnMoves = []
      nextState.isInExtraTurn = false
    } else {
      events.push({ type: 'send-move', index, color: selectedColor })
    }
  } else {
    nextState.pendingExtraTurnMoves = []
    nextState.isInExtraTurn = false
  }

  nextState.totalTurns += 1

  if (nextState.totalTurns >= nextState.maxTurns) {
    finishMatch(nextState, events)
    return { state: nextState, events }
  }

  transitionTurn(nextState)
  return { state: nextState, events }
}

export function applyRemoteMove(
  state: GameState,
  index: number,
  color: PaintColor,
): EngineResult {
  const nextState = cloneState(state)
  const events: EngineEvent[] = []

  nextState.opponentGrid.cells[index] = {
    occupied: true,
    color,
    immune: nextState.opponentGrid.cells[index].immune,
  }

  if (nextState.playerGrid.cells[index].occupied) {
    resolveConflict(nextState, index, events)
  }

  nextState.totalTurns += 1

  if (nextState.totalTurns >= nextState.maxTurns) {
    finishMatch(nextState, events)
    return { state: nextState, events }
  }

  transitionTurn(nextState)
  return { state: nextState, events }
}

export function applyRemoteMoves(
  state: GameState,
  moves: QueuedMove[],
): EngineResult {
  const nextState = cloneState(state)
  const events: EngineEvent[] = []

  for (const move of moves) {
    nextState.opponentGrid.cells[move.index] = {
      occupied: true,
      color: move.color,
      immune: nextState.opponentGrid.cells[move.index].immune,
    }

    if (nextState.playerGrid.cells[move.index].occupied) {
      resolveConflict(nextState, move.index, events)
    }
  }

  nextState.totalTurns += 1

  if (nextState.totalTurns >= nextState.maxTurns) {
    finishMatch(nextState, events)
    return { state: nextState, events }
  }

  transitionTurn(nextState)
  return { state: nextState, events }
}

export function applyRemoteImmuneStatus(
  state: GameState,
  indices: number[],
): EngineResult {
  const nextState = cloneState(state)
  const events: EngineEvent[] = [createAnnouncement('Opponent used shield!!')]

  for (const index of indices) {
    if (nextState.opponentGrid.cells[index]) {
      nextState.opponentGrid.cells[index].immune = true
    }
  }

  return { state: nextState, events }
}

export function pickAiMove(state: GameState, random: RandomFn = Math.random) {
  const available = state.opponentGrid.cells.flatMap((cell, index) => (cell.occupied ? [] : [index]))

  if (available.length === 0) {
    return null
  }

  return {
    index: pickRandomIndex(available, random),
    color: pickRandomColor(random),
  }
}

export function forceTimeoutAction(
  state: GameState,
  random: RandomFn = Math.random,
): EngineResult {
  let workingState = cloneState(state)
  let aggregatedEvents: EngineEvent[] = [createAnnouncement('Timer expired!')]

  if (workingState.shieldSelectionMode) {
    const shieldable = workingState.playerGrid.cells.flatMap((cell, index) =>
      cell.occupied && cell.color ? [index] : [],
    )

    if (shieldable.length > 0) {
      const shieldResult = applyShieldSelection(
        workingState,
        pickRandomIndex(shieldable, random),
      )
      workingState = shieldResult.state
      aggregatedEvents = aggregatedEvents.concat(shieldResult.events)
    } else {
      workingState.shieldSelectionMode = false
    }
  }

  const available = workingState.playerGrid.cells.flatMap((cell, index) => (cell.occupied ? [] : [index]))
  if (available.length === 0) {
    return { state: workingState, events: aggregatedEvents }
  }

  const color = pickRandomColor(random)
  const moveResult = applyLocalMove(
    selectColor(workingState, color),
    pickRandomIndex(available, random),
    color,
  )

  return {
    state: moveResult.state,
    events: aggregatedEvents.concat(moveResult.events),
  }
}
