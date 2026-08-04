export const GAME_CORE_VERSION = '0.0.0' as const

export type Seat = 0 | 1
export type LocationId = number
export type ClassicSymbol = 'rock' | 'paper' | 'scissors'
export type PowerupKey = 'shield' | 'reveal' | 'extraTurn'

export interface MatchRules {
  readonly rounds: number
  readonly turnSeconds: number
  readonly blindMode: boolean
}

export const DEFAULT_MATCH_RULES: Readonly<MatchRules> = Object.freeze({
  rounds: 6,
  turnSeconds: 10,
  blindMode: true,
})

export function decodeMatchRules(value: unknown): MatchRules | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.rounds !== 'number' ||
    !Number.isFinite(candidate.rounds) ||
    typeof candidate.turnSeconds !== 'number' ||
    !Number.isFinite(candidate.turnSeconds) ||
    typeof candidate.blindMode !== 'boolean'
  ) {
    return undefined
  }

  return {
    rounds: candidate.rounds,
    turnSeconds: candidate.turnSeconds,
    blindMode: candidate.blindMode,
  }
}

export function clampMatchRules(
  value: Partial<Record<keyof MatchRules, unknown>> | null | undefined,
): MatchRules {
  const rounds = finiteNumberOrDefault(value?.rounds, DEFAULT_MATCH_RULES.rounds)
  const turnSeconds = finiteNumberOrDefault(
    value?.turnSeconds,
    DEFAULT_MATCH_RULES.turnSeconds,
  )

  return {
    rounds: Math.min(20, Math.max(1, Math.trunc(rounds))),
    turnSeconds: Math.min(60, Math.max(2, Math.trunc(turnSeconds))),
    blindMode:
      typeof value?.blindMode === 'boolean'
        ? value.blindMode
        : DEFAULT_MATCH_RULES.blindMode,
  }
}

function finiteNumberOrDefault(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export const ENGINE_ID = 'classic' as const
export const ENGINE_REVISION = 1 as const

export type BoardSize = 3 | 4 | 5

export interface EngineRef {
  readonly id: typeof ENGINE_ID
  readonly revision: number
}

// Pattern order is load-bearing: `maybeUnlockPowerup` returns on the first
// match, so reordering changes which power-up unlocks when two lines complete
// on the same turn. The 3x3 output is asserted against the legacy order.
export function createTopology(
  boardSize: BoardSize,
  streak: number,
): ClassicTopology {
  if (!Number.isInteger(streak) || streak < 2 || streak > boardSize) {
    throw new Error(
      `Invalid streak ${streak} for a ${boardSize}x${boardSize} board.`,
    )
  }

  const locationIds: LocationId[] = []
  for (let index = 0; index < boardSize * boardSize; index += 1) {
    locationIds.push(index)
  }

  const at = (row: number, column: number) => row * boardSize + column
  const offsets: number[] = []
  for (let step = 0; step < streak; step += 1) offsets.push(step)
  const windows = boardSize - streak + 1
  const winningPatterns: LocationId[][] = []

  for (let row = 0; row < boardSize; row += 1) {
    for (let column = 0; column < windows; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row, column + step)))
    }
  }
  for (let column = 0; column < boardSize; column += 1) {
    for (let row = 0; row < windows; row += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column)))
    }
  }
  for (let row = 0; row < windows; row += 1) {
    for (let column = 0; column < windows; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column + step)))
    }
  }
  for (let row = 0; row < windows; row += 1) {
    for (let column = streak - 1; column < boardSize; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column - step)))
    }
  }

  return deepFreeze({ locationIds, winningPatterns })
}

export interface GameConfig {
  readonly boardSize: BoardSize
  readonly streak: number
  readonly rounds: number
  readonly turnSeconds: number
  readonly blindMode: boolean
  readonly powerupsEnabled: boolean
  readonly powerups: Readonly<Record<PowerupKey, boolean>>
  readonly powerupBySymbol: Readonly<Record<ClassicSymbol, PowerupKey>>
  readonly forbidImmediateRepeat: boolean
}

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = deepFreeze({
  boardSize: 3,
  streak: 3,
  rounds: 6,
  turnSeconds: 10,
  blindMode: true,
  powerupsEnabled: true,
  powerups: { shield: true, reveal: true, extraTurn: true },
  powerupBySymbol: { rock: 'shield', paper: 'reveal', scissors: 'extraTurn' },
  forbidImmediateRepeat: false,
}) as Readonly<GameConfig>

const BOARD_SIZES: readonly BoardSize[] = [3, 4, 5]
const SYMBOLS: readonly ClassicSymbol[] = ['rock', 'paper', 'scissors']
const POWERUP_KEYS: readonly PowerupKey[] = ['shield', 'reveal', 'extraTurn']

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = finiteNumberOrDefault(value, fallback)
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

// Tolerant by design: unknown fields are ignored and missing fields fall back
// to the default game, so an older client degrades instead of failing to join.
export function clampGameConfig(value: unknown): GameConfig {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  const requestedSize = clampInteger(
    candidate.boardSize,
    3,
    5,
    DEFAULT_GAME_CONFIG.boardSize,
  )
  const boardSize = (
    BOARD_SIZES.includes(requestedSize as BoardSize)
      ? requestedSize
      : DEFAULT_GAME_CONFIG.boardSize
  ) as BoardSize

  const powerupsInput =
    candidate.powerups && typeof candidate.powerups === 'object'
      ? (candidate.powerups as Record<string, unknown>)
      : {}
  const powerups = {} as Record<PowerupKey, boolean>
  for (const key of POWERUP_KEYS) {
    powerups[key] = booleanOrDefault(
      powerupsInput[key],
      DEFAULT_GAME_CONFIG.powerups[key],
    )
  }

  const mappingInput =
    candidate.powerupBySymbol && typeof candidate.powerupBySymbol === 'object'
      ? (candidate.powerupBySymbol as Record<string, unknown>)
      : {}
  const powerupBySymbol = {} as Record<ClassicSymbol, PowerupKey>
  for (const symbol of SYMBOLS) {
    const mapped = mappingInput[symbol]
    powerupBySymbol[symbol] = POWERUP_KEYS.includes(mapped as PowerupKey)
      ? (mapped as PowerupKey)
      : DEFAULT_GAME_CONFIG.powerupBySymbol[symbol]
  }

  return {
    boardSize,
    streak: clampInteger(candidate.streak, 2, boardSize, Math.min(3, boardSize)),
    rounds: clampInteger(candidate.rounds, 1, 20, DEFAULT_GAME_CONFIG.rounds),
    turnSeconds: clampInteger(
      candidate.turnSeconds,
      2,
      60,
      DEFAULT_GAME_CONFIG.turnSeconds,
    ),
    blindMode: booleanOrDefault(candidate.blindMode, DEFAULT_GAME_CONFIG.blindMode),
    powerupsEnabled: booleanOrDefault(
      candidate.powerupsEnabled,
      DEFAULT_GAME_CONFIG.powerupsEnabled,
    ),
    powerups,
    powerupBySymbol,
    forbidImmediateRepeat: booleanOrDefault(
      candidate.forbidImmediateRepeat,
      DEFAULT_GAME_CONFIG.forbidImmediateRepeat,
    ),
  }
}

export function decodeGameConfig(value: unknown): GameConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return clampGameConfig(value)
}

export interface ModeRef {
  readonly id: 'classic'
  readonly revision: 1
}

export interface GameSpec {
  readonly mode: ModeRef
  readonly rules: MatchRules
  readonly seed: number
  readonly firstSeat: Seat
}

export interface ClassicTopology {
  readonly locationIds: readonly LocationId[]
  readonly winningPatterns: readonly (readonly LocationId[])[]
}

export interface ClassicMode {
  readonly id: 'classic'
  readonly revision: 1
  readonly randomAlgorithm: 'mulberry32-v1'
  readonly topology: ClassicTopology
  readonly defeats: Readonly<Record<ClassicSymbol, ClassicSymbol>>
  readonly powerupBySymbol: Readonly<Record<ClassicSymbol, PowerupKey>>
}

export type ModeRegistry = Readonly<Record<'classic@1', ClassicMode>>

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
  }
  return value
}

export const CLASSIC_V1: ClassicMode = deepFreeze({
  id: 'classic',
  revision: 1,
  randomAlgorithm: 'mulberry32-v1',
  topology: {
    locationIds: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    winningPatterns: [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ],
  },
  defeats: {
    rock: 'scissors',
    paper: 'rock',
    scissors: 'paper',
  },
  powerupBySymbol: {
    rock: 'shield',
    paper: 'reveal',
    scissors: 'extraTurn',
  },
})

export const MODE_REGISTRY: ModeRegistry = deepFreeze({
  'classic@1': CLASSIC_V1,
})

export type GameCommand =
  | { readonly type: 'place'; readonly locationId: LocationId; readonly symbol: ClassicSymbol }
  | { readonly type: 'activate-powerup'; readonly powerup: PowerupKey }
  | { readonly type: 'select-shield-target'; readonly locationId: LocationId }
  | { readonly type: 'timeout' }

export interface Placement {
  readonly locationId: LocationId
  readonly symbol: ClassicSymbol
}

export interface LocationState {
  readonly locationId: LocationId
  readonly symbol: ClassicSymbol | null
  readonly immune: boolean
}

export interface BoardState {
  readonly locations: readonly LocationState[]
}

export interface PlayerPowerups {
  readonly unlocked: Readonly<Record<PowerupKey, boolean>>
  readonly used: Readonly<Record<PowerupKey, boolean>>
  readonly revealActive: boolean
  readonly extraTurnArmed: boolean
  readonly extraTurnInProgress: boolean
  readonly shieldSelectionPending: boolean
}

export interface GameResult {
  readonly scores: readonly [number, number]
  readonly winner: Seat | null
}

export interface GameState {
  readonly spec: GameSpec
  readonly mode: ClassicMode
  readonly phase: 'active' | 'finished'
  readonly boards: readonly [BoardState, BoardState]
  readonly powerups: readonly [PlayerPowerups, PlayerPowerups]
  readonly activeSeat: Seat
  readonly turnCount: number
  readonly currentRound: number
  readonly maxTurns: number
  readonly pendingExtraPlacements: readonly Placement[]
  readonly result: GameResult | null
  readonly randomState: number
}

export type DomainEvent =
  | { readonly type: 'timeout'; readonly seat: Seat }
  | { readonly type: 'cell-destroyed'; readonly seat: Seat; readonly locationId: LocationId; readonly symbol: ClassicSymbol }
  | { readonly type: 'shield-protected'; readonly seat: Seat; readonly locationId: LocationId }
  | { readonly type: 'powerup-unlocked'; readonly seat: Seat; readonly powerup: PowerupKey }
  | { readonly type: 'powerup-activated'; readonly seat: Seat; readonly powerup: PowerupKey }
  | { readonly type: 'shield-selected'; readonly seat: Seat; readonly locationId: LocationId }
  | { readonly type: 'extra-turn-started'; readonly seat: Seat }
  | { readonly type: 'placements-committed'; readonly seat: Seat; readonly placements: readonly Placement[] }
  | { readonly type: 'turn-passed'; readonly seat: Seat }
  | { readonly type: 'game-finished'; readonly scores: readonly [number, number]; readonly winner: Seat | null }

export type RejectionReason =
  | 'invalid-command'
  | 'not-active-seat'
  | 'game-finished'
  | 'unknown-location'
  | 'location-occupied'
  | 'powerup-locked'
  | 'powerup-used'
  | 'shield-selection-pending'
  | 'shield-selection-not-pending'
  | 'invalid-shield-target'

export interface ApplyResult {
  readonly accepted: boolean
  readonly state: GameState
  readonly events: readonly DomainEvent[]
  readonly rejection?: { readonly reason: RejectionReason }
}

function createPowerups(): PlayerPowerups {
  return {
    unlocked: { shield: false, reveal: false, extraTurn: false },
    used: { shield: false, reveal: false, extraTurn: false },
    revealActive: false,
    extraTurnArmed: false,
    extraTurnInProgress: false,
    shieldSelectionPending: false,
  }
}

function createBoard(mode: ClassicMode): BoardState {
  return {
    locations: mode.topology.locationIds.map((locationId) => ({
      locationId,
      symbol: null,
      immune: false,
    })),
  }
}

export function createGame(
  spec: GameSpec,
  registry: ModeRegistry = MODE_REGISTRY,
): GameState {
  const mode = registry[`${spec.mode.id}@${spec.mode.revision}`]
  if (!mode) {
    throw new Error(`Unsupported game mode: ${spec.mode.id}@${spec.mode.revision}`)
  }

  return {
    spec: {
      mode: { ...spec.mode },
      rules: { ...spec.rules },
      seed: spec.seed >>> 0,
      firstSeat: spec.firstSeat,
    },
    mode,
    phase: 'active',
    boards: [createBoard(mode), createBoard(mode)],
    powerups: [createPowerups(), createPowerups()],
    activeSeat: spec.firstSeat,
    turnCount: 0,
    currentRound: 1,
    maxTurns: spec.rules.rounds * 2,
    pendingExtraPlacements: [],
    result: null,
    randomState: spec.seed >>> 0,
  }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    spec: {
      mode: { ...state.spec.mode },
      rules: { ...state.spec.rules },
      seed: state.spec.seed,
      firstSeat: state.spec.firstSeat,
    },
    boards: state.boards.map((board) => ({
      locations: board.locations.map((location) => ({ ...location })),
    })) as unknown as [BoardState, BoardState],
    powerups: state.powerups.map((powerups) => ({
      ...powerups,
      unlocked: { ...powerups.unlocked },
      used: { ...powerups.used },
    })) as unknown as [PlayerPowerups, PlayerPowerups],
    pendingExtraPlacements: state.pendingExtraPlacements.map((placement) => ({ ...placement })),
    result: state.result
      ? { scores: [...state.result.scores] as [number, number], winner: state.result.winner }
      : null,
  }
}

function reject(state: GameState, reason: RejectionReason): ApplyResult {
  return { accepted: false, state, events: [], rejection: { reason } }
}

function isSeat(value: unknown): value is Seat {
  return value === 0 || value === 1
}

function isLocationId(value: unknown): value is LocationId {
  return typeof value === 'number' && Number.isFinite(value)
}

function isClassicSymbol(value: unknown): value is ClassicSymbol {
  return value === 'rock' || value === 'paper' || value === 'scissors'
}

function isPowerupKey(value: unknown): value is PowerupKey {
  return value === 'shield' || value === 'reveal' || value === 'extraTurn'
}

function isGameCommand(value: unknown): value is GameCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  switch (candidate.type) {
    case 'place':
      return isLocationId(candidate.locationId) && isClassicSymbol(candidate.symbol)
    case 'activate-powerup':
      return isPowerupKey(candidate.powerup)
    case 'select-shield-target':
      return isLocationId(candidate.locationId)
    case 'timeout':
      return true
    default:
      return false
  }
}

function otherSeat(seat: Seat): Seat {
  return (1 - seat) as Seat
}

function locationIndex(state: GameState, seat: Seat, locationId: LocationId) {
  return state.boards[seat].locations.findIndex((location) => location.locationId === locationId)
}

function hasLegalPlacement(state: GameState, seat: Seat) {
  return state.boards[seat].locations.some((location) => location.symbol === null)
}

function setLocation(
  state: GameState,
  seat: Seat,
  locationId: LocationId,
  update: Partial<LocationState>,
) {
  const index = locationIndex(state, seat, locationId)
  const locations = state.boards[seat].locations as LocationState[]
  locations[index] = { ...locations[index], ...update }
}

function finishGame(state: GameState, events: DomainEvent[]) {
  const scores: [number, number] = [
    state.boards[0].locations.filter((location) => location.symbol !== null).length,
    state.boards[1].locations.filter((location) => location.symbol !== null).length,
  ]
  const winner: Seat | null = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1
  ;(state as Mutable<GameState>).phase = 'finished'
  ;(state as Mutable<GameState>).result = { scores, winner }
  events.push({ type: 'game-finished', scores, winner })
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] }

function consumeTurn(state: GameState, events: DomainEvent[]) {
  const mutable = state as Mutable<GameState>
  mutable.turnCount += 1
  mutable.currentRound = Math.min(
    state.spec.rules.rounds,
    Math.floor(state.turnCount / 2) + 1,
  )
  if (state.turnCount >= state.maxTurns) {
    finishGame(state, events)
    return
  }
  mutable.activeSeat = otherSeat(state.activeSeat)
  resolveAutomaticPasses(state, events)
}

function resolveAutomaticPasses(state: GameState, events: DomainEvent[]) {
  while (state.phase === 'active' && !hasLegalPlacement(state, state.activeSeat)) {
    const passedSeat = state.activeSeat
    events.push({ type: 'turn-passed', seat: passedSeat })
    const mutable = state as Mutable<GameState>
    mutable.turnCount += 1
    mutable.currentRound = Math.min(
      state.spec.rules.rounds,
      Math.floor(state.turnCount / 2) + 1,
    )
    if (state.turnCount >= state.maxTurns) {
      finishGame(state, events)
      return
    }
    mutable.activeSeat = otherSeat(passedSeat)
  }
}

function comparison(mode: ClassicMode, first: ClassicSymbol, second: ClassicSymbol) {
  if (first === second) {
    return { clearFirst: true, clearSecond: true }
  }
  return {
    clearFirst: mode.defeats[second] === first,
    clearSecond: mode.defeats[first] === second,
  }
}

function clearLocation(state: GameState, seat: Seat, locationId: LocationId) {
  setLocation(state, seat, locationId, { symbol: null, immune: false })
}

function handleImmunity(
  state: GameState,
  defender: Seat,
  attacker: Seat,
  locationId: LocationId,
  shouldClear: boolean,
  events: DomainEvent[],
) {
  if (!shouldClear) return false
  const defenderLocation = state.boards[defender].locations[locationIndex(state, defender, locationId)]
  if (!defenderLocation.immune) return true
  setLocation(state, defender, locationId, { immune: false })
  clearLocation(state, attacker, locationId)
  events.push({ type: 'shield-protected', seat: defender, locationId })
  return false
}

function resolveConflict(state: GameState, locationId: LocationId, events: DomainEvent[]) {
  const first = state.boards[0].locations[locationIndex(state, 0, locationId)]
  const second = state.boards[1].locations[locationIndex(state, 1, locationId)]
  if (!first?.symbol || !second?.symbol) return

  const firstSymbol = first.symbol
  const secondSymbol = second.symbol
  const outcome = comparison(state.mode, firstSymbol, secondSymbol)
  const clearFirst = handleImmunity(state, 0, 1, locationId, outcome.clearFirst, events)
  const clearSecond = handleImmunity(state, 1, 0, locationId, outcome.clearSecond, events)
  if (clearFirst) clearLocation(state, 0, locationId)
  if (clearSecond) clearLocation(state, 1, locationId)

  if (state.boards[0].locations[locationIndex(state, 0, locationId)]?.symbol === null) {
    events.push({ type: 'cell-destroyed', seat: 0, locationId, symbol: firstSymbol })
  }
  if (state.boards[1].locations[locationIndex(state, 1, locationId)]?.symbol === null) {
    events.push({ type: 'cell-destroyed', seat: 1, locationId, symbol: secondSymbol })
  }
}

function maybeUnlockPowerup(state: GameState, seat: Seat, events: DomainEvent[]) {
  for (const pattern of state.mode.topology.winningPatterns) {
    const locations = pattern.map(
      (locationId) => state.boards[seat].locations[locationIndex(state, seat, locationId)],
    )
    const symbol = locations[0]?.symbol
    if (!symbol || locations.some((location) => location?.symbol !== symbol)) continue
    const powerup = state.mode.powerupBySymbol[symbol]
    if (state.powerups[seat].unlocked[powerup]) continue
    const playerPowerups = state.powerups[seat] as Mutable<PlayerPowerups>
    playerPowerups.unlocked = { ...playerPowerups.unlocked, [powerup]: true }
    events.push({ type: 'powerup-unlocked', seat, powerup })
    return
  }
}

function place(state: GameState, seat: Seat, command: Extract<GameCommand, { type: 'place' }>) {
  if (state.powerups[seat].shieldSelectionPending) {
    return reject(state, 'shield-selection-pending')
  }
  const index = locationIndex(state, seat, command.locationId)
  if (index < 0) return reject(state, 'unknown-location')
  if (state.boards[seat].locations[index]?.symbol !== null) {
    return reject(state, 'location-occupied')
  }

  const next = cloneState(state)
  const events: DomainEvent[] = []
  setLocation(next, seat, command.locationId, { symbol: command.symbol })
  const playerPowerups = next.powerups[seat] as Mutable<PlayerPowerups>
  playerPowerups.revealActive = false
  resolveConflict(next, command.locationId, events)
  maybeUnlockPowerup(next, seat, events)

  const placement: Placement = { locationId: command.locationId, symbol: command.symbol }
  if (playerPowerups.extraTurnArmed) {
    playerPowerups.extraTurnArmed = false
    playerPowerups.extraTurnInProgress = true
    ;(next as Mutable<GameState>).pendingExtraPlacements = [placement]
    events.push({ type: 'extra-turn-started', seat })
    if (!hasLegalPlacement(next, seat)) {
      playerPowerups.extraTurnInProgress = false
      events.push({ type: 'placements-committed', seat, placements: [placement] })
      ;(next as Mutable<GameState>).pendingExtraPlacements = []
      events.push({ type: 'turn-passed', seat })
      consumeTurn(next, events)
    }
    return { accepted: true, state: next, events }
  }

  if (playerPowerups.extraTurnInProgress) {
    const placements = [...next.pendingExtraPlacements, placement]
    playerPowerups.extraTurnInProgress = false
    ;(next as Mutable<GameState>).pendingExtraPlacements = []
    events.push({ type: 'placements-committed', seat, placements })
    consumeTurn(next, events)
    return { accepted: true, state: next, events }
  }

  events.push({ type: 'placements-committed', seat, placements: [placement] })
  consumeTurn(next, events)
  return { accepted: true, state: next, events }
}

function activatePowerup(
  state: GameState,
  seat: Seat,
  powerup: PowerupKey,
): ApplyResult {
  const current = state.powerups[seat]
  if (!current.unlocked[powerup]) return reject(state, 'powerup-locked')
  if (current.used[powerup]) return reject(state, 'powerup-used')

  const next = cloneState(state)
  const nextPowerups = next.powerups[seat] as Mutable<PlayerPowerups>
  nextPowerups.used = { ...nextPowerups.used, [powerup]: true }
  if (powerup === 'shield') nextPowerups.shieldSelectionPending = true
  if (powerup === 'reveal') nextPowerups.revealActive = true
  if (powerup === 'extraTurn') nextPowerups.extraTurnArmed = true
  return {
    accepted: true,
    state: next,
    events: [{ type: 'powerup-activated', seat, powerup }],
  }
}

function selectShieldTarget(
  state: GameState,
  seat: Seat,
  locationId: LocationId,
): ApplyResult {
  if (!state.powerups[seat].shieldSelectionPending) {
    return reject(state, 'shield-selection-not-pending')
  }
  const index = locationIndex(state, seat, locationId)
  if (index < 0) return reject(state, 'unknown-location')
  if (state.boards[seat].locations[index]?.symbol === null) {
    return reject(state, 'invalid-shield-target')
  }

  const next = cloneState(state)
  setLocation(next, seat, locationId, { immune: true })
  ;(next.powerups[seat] as Mutable<PlayerPowerups>).shieldSelectionPending = false
  return {
    accepted: true,
    state: next,
    events: [{ type: 'shield-selected', seat, locationId }],
  }
}

export function applyCommand(
  state: GameState,
  actor: Seat,
  command: GameCommand,
): ApplyResult {
  if (!isSeat(actor) || !isGameCommand(command)) return reject(state, 'invalid-command')
  if (state.phase === 'finished') return reject(state, 'game-finished')
  if (actor !== state.activeSeat) return reject(state, 'not-active-seat')
  if (command.type === 'timeout') return applyTimeout(state)
  if (command.type === 'place') return place(state, actor, command)
  if (command.type === 'activate-powerup') {
    return activatePowerup(state, actor, command.powerup)
  }
  return selectShieldTarget(state, actor, command.locationId)
}

function nextRandom(state: GameState) {
  const randomState = (state.randomState + 0x6d2b79f5) >>> 0
  let value = randomState
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return {
    randomState,
    value: ((value ^ (value >>> 14)) >>> 0) / 4294967296,
  }
}

function choose<T>(state: GameState, values: readonly T[]) {
  const random = nextRandom(state)
  ;(state as Mutable<GameState>).randomState = random.randomState
  return values[Math.floor(random.value * values.length)] as T
}

export function applyTimeout(state: GameState): ApplyResult {
  if (state.phase === 'finished') return reject(state, 'game-finished')
  let working = cloneState(state)
  const actor = working.activeSeat
  const events: DomainEvent[] = [{ type: 'timeout', seat: actor }]

  if (working.powerups[actor].shieldSelectionPending) {
    const targets = working.boards[actor].locations.filter((location) => location.symbol !== null)
    if (targets.length > 0) {
      const target = choose(working, targets)
      const shield = selectShieldTarget(working, actor, target.locationId)
      working = shield.state
      events.push(...shield.events)
    } else {
      ;(working.powerups[actor] as Mutable<PlayerPowerups>).shieldSelectionPending = false
    }
  }

  const available = working.boards[actor].locations.filter((location) => location.symbol === null)
  if (available.length === 0) {
    events.push({ type: 'turn-passed', seat: actor })
    consumeTurn(working, events)
    return { accepted: true, state: working, events }
  }

  const symbol = choose(working, ['rock', 'paper', 'scissors'] as const)
  const location = choose(working, available)
  const placement = place(working, actor, {
    type: 'place',
    locationId: location.locationId,
    symbol,
  })
  return {
    accepted: true,
    state: placement.state,
    events: [...events, ...placement.events],
  }
}
