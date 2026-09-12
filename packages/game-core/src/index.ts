export const GAME_CORE_VERSION = '0.0.0' as const

import {
  DEFAULT_GAME_CONFIG,
  ENGINE_ID,
  ENGINE_REVISION,
  clampGameConfig,
  deepFreeze,
  type ClassicSymbol,
  type EngineRef,
  type GameConfig,
  type LocationId,
  type PowerupKey,
  type Seat,
} from './config.ts'
import { createTopology, type ClassicTopology } from './topology.ts'

// Set on a cell when its piece is destroyed, and decremented at the start of
// each of the owner's turns. Two rather than one because the destruction lands
// after that turn's decrement has already run — with one, a cell that died on
// its owner's own turn would reopen a full turn early.
const DESECRATION_TURNS = 2

export interface GameSpec {
  readonly engine: EngineRef
  readonly config: GameConfig
  readonly seed: number
  readonly firstSeat: Seat
}

// `GameState.spec` and the server's `MatchRun` refer to the spec after
// `createGame` has normalised it. Normalisation no longer changes the shape,
// so this is an alias rather than a second interface.
export type ResolvedGameSpec = GameSpec

export interface ClassicMode {
  readonly id: 'classic'
  readonly revision: typeof ENGINE_REVISION
  readonly randomAlgorithm: 'mulberry32-v1'
  readonly topology: ClassicTopology
  readonly defeats: Readonly<Record<ClassicSymbol, ClassicSymbol>>
  readonly powerupBySymbol: Readonly<Record<ClassicSymbol, PowerupKey>>
}

export type GameCommand =
  | { readonly type: 'place'; readonly locationId: LocationId; readonly symbol: ClassicSymbol }
  | { readonly type: 'activate-powerup'; readonly powerup: PowerupKey }
  | { readonly type: 'select-shield-target'; readonly locationId: LocationId }
  /**
   * Closes the reveal snapshot. Issued by the authority when the window it
   * armed expires, and by the player closing it early; the two race, so this
   * has to be inert when the reveal is already down.
   */
  | { readonly type: 'end-reveal' }
  | { readonly type: 'timeout' }

export interface Placement {
  readonly locationId: LocationId
  readonly symbol: ClassicSymbol
}

export interface LocationState {
  readonly locationId: LocationId
  readonly symbol: ClassicSymbol | null
  readonly immune: boolean
  /** Owner turns left before a destroyed cell is playable again; 0 is playable. */
  readonly desecratedTurns: number
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
  readonly spec: ResolvedGameSpec
  readonly mode: ClassicMode
  readonly config: GameConfig
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
  | { readonly type: 'reveal-ended'; readonly seat: Seat }
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
  | 'desecrated-location'

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
      desecratedTurns: 0,
    })),
  }
}

function buildMode(config: GameConfig): ClassicMode {
  return deepFreeze({
    id: ENGINE_ID,
    revision: ENGINE_REVISION,
    randomAlgorithm: 'mulberry32-v1',
    topology: createTopology(config.boardSize, config.streak),
    defeats: { rock: 'scissors', paper: 'rock', scissors: 'paper' },
    powerupBySymbol: config.powerupBySymbol,
  }) as ClassicMode
}

export function createGame(spec: GameSpec): GameState {
  if (spec.engine.id !== ENGINE_ID || spec.engine.revision !== ENGINE_REVISION) {
    throw new Error(
      `Unsupported engine ${spec.engine.id}@${spec.engine.revision}; this build runs ${ENGINE_ID}@${ENGINE_REVISION}.`,
    )
  }
  const resolved: ResolvedGameSpec = {
    engine: spec.engine,
    config: clampGameConfig(spec.config),
    seed: spec.seed >>> 0,
    firstSeat: spec.firstSeat,
  }
  const mode = buildMode(resolved.config)

  return {
    spec: resolved,
    mode,
    config: resolved.config,
    phase: 'active',
    boards: [createBoard(mode), createBoard(mode)],
    powerups: [createPowerups(), createPowerups()],
    activeSeat: resolved.firstSeat,
    turnCount: 0,
    currentRound: 1,
    maxTurns: resolved.config.rounds * 2,
    pendingExtraPlacements: [],
    result: null,
    randomState: resolved.seed,
  }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    spec: {
      engine: { ...state.spec.engine },
      // `config` is deep-frozen at clamp time, so sharing the reference avoids
      // re-cloning a nested object on every command.
      config: state.spec.config,
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
    case 'end-reveal':
      return true
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

function isPlayable(location: LocationState) {
  return location.symbol === null && location.desecratedTurns === 0
}

function hasLegalPlacement(state: GameState, seat: Seat) {
  return state.boards[seat].locations.some(isPlayable)
}

// Desecration decays on its owner's turns, so a destroyed cell costs that owner
// exactly one turn spent elsewhere before the cell can be contested again.
// Called wherever `activeSeat` is assigned, so an auto-passed turn still counts.
function beginTurn(state: GameState, seat: Seat) {
  const locations = state.boards[seat].locations as LocationState[]
  for (let index = 0; index < locations.length; index += 1) {
    const location = locations[index]
    if (location && location.desecratedTurns > 0) {
      locations[index] = {
        ...location,
        desecratedTurns: location.desecratedTurns - 1,
      }
    }
  }
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
    state.config.rounds,
    Math.floor(state.turnCount / 2) + 1,
  )
  if (state.turnCount >= state.maxTurns) {
    finishGame(state, events)
    return
  }
  mutable.activeSeat = otherSeat(state.activeSeat)
  beginTurn(state, state.activeSeat)
  resolveAutomaticPasses(state, events)
}

function resolveAutomaticPasses(state: GameState, events: DomainEvent[]) {
  while (state.phase === 'active' && !hasLegalPlacement(state, state.activeSeat)) {
    const passedSeat = state.activeSeat
    events.push({ type: 'turn-passed', seat: passedSeat })
    const mutable = state as Mutable<GameState>
    mutable.turnCount += 1
    mutable.currentRound = Math.min(
      state.config.rounds,
      Math.floor(state.turnCount / 2) + 1,
    )
    if (state.turnCount >= state.maxTurns) {
      finishGame(state, events)
      return
    }
    mutable.activeSeat = otherSeat(passedSeat)
    beginTurn(state, state.activeSeat)
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

  // Desecration is set exactly where `cell-destroyed` is emitted so the rule and
  // the event a client animates can never describe different cells.
  if (state.boards[0].locations[locationIndex(state, 0, locationId)]?.symbol === null) {
    setLocation(state, 0, locationId, { desecratedTurns: DESECRATION_TURNS })
    events.push({ type: 'cell-destroyed', seat: 0, locationId, symbol: firstSymbol })
  }
  if (state.boards[1].locations[locationIndex(state, 1, locationId)]?.symbol === null) {
    setLocation(state, 1, locationId, { desecratedTurns: DESECRATION_TURNS })
    events.push({ type: 'cell-destroyed', seat: 1, locationId, symbol: secondSymbol })
  }
}

function maybeUnlockPowerup(state: GameState, seat: Seat, events: DomainEvent[]) {
  if (!state.config.powerupsEnabled) return
  for (const pattern of state.mode.topology.winningPatterns) {
    const locations = pattern.map(
      (locationId) => state.boards[seat].locations[locationIndex(state, seat, locationId)],
    )
    const symbol = locations[0]?.symbol
    if (!symbol || locations.some((location) => location?.symbol !== symbol)) continue
    const powerup = state.mode.powerupBySymbol[symbol]
    // `continue`, not `return`: a line for a disabled power-up must not block
    // a different line from unlocking an enabled one on the same turn.
    if (!state.config.powerups[powerup]) continue
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
  const target = state.boards[seat].locations[index]
  if (target?.symbol !== null) {
    return reject(state, 'location-occupied')
  }
  if (target.desecratedTurns > 0) {
    return reject(state, 'desecrated-location')
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
  if (!state.config.powerupsEnabled) return reject(state, 'powerup-locked')
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

function endReveal(state: GameState, seat: Seat): ApplyResult {
  // Already down: accept and return the same state. The early close and the
  // armed window race by design, and a rejection would have the authority
  // logging a failure for a command that did exactly what it was for.
  if (!state.powerups[seat].revealActive) {
    return { accepted: true, state, events: [] }
  }
  const next = cloneState(state)
  ;(next.powerups[seat] as Mutable<PlayerPowerups>).revealActive = false
  return { accepted: true, state: next, events: [{ type: 'reveal-ended', seat }] }
}

export function applyCommand(
  state: GameState,
  actor: Seat,
  command: GameCommand,
): ApplyResult {
  if (!isSeat(actor) || !isGameCommand(command)) return reject(state, 'invalid-command')
  if (state.phase === 'finished') return reject(state, 'game-finished')
  /*
   * Closing a snapshot is exempt from the active-seat check, and deliberately.
   * The turn clock runs underneath the window, so a turn can time out while the
   * reveal is still up and the authority's expiry then arrives on the other
   * seat's turn. Rejecting it would leave `revealActive` true until the player's
   * next placement, which is the open-ended reveal this replaced. Lowering a
   * seat's own flag can only ever take information away from that seat, so
   * there is nothing here to abuse.
   */
  if (command.type === 'end-reveal') return endReveal(state, actor)
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

  // Desecrated cells are empty, so an unfiltered pick would hand `place` a
  // location it rejects and the turn would never be consumed.
  const available = working.boards[actor].locations.filter(isPlayable)
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

/*
 * The package's public surface, listed rather than star-exported.
 *
 * `export *` would also publish internal helpers — `deepFreeze` is the one that
 * would slip out today — and a protocol package's surface is worth being a
 * thing somebody has to type. `index.test.ts` asserts this list.
 */
export {
  DEFAULT_GAME_CONFIG,
  ENGINE_ID,
  ENGINE_REVISION,
  MAX_REVEAL_SECONDS,
  MAX_TURN_SECONDS,
  MIN_REVEAL_SECONDS,
  MIN_TURN_SECONDS,
  ONLINE_MIN_TURN_SECONDS,
  PROTOTYPE_BOARD_SIZE,
  PROTOTYPE_ROUNDS,
  clampGameConfig,
  clampOnlineGameConfig,
  decodeGameConfig,
  defaultConfigForVariant,
} from './config.ts'
export type {
  BoardSize,
  ClassicSymbol,
  EngineRef,
  GameConfig,
  GameVariant,
  LocationId,
  PowerupKey,
  Seat,
} from './config.ts'
export { createTopology } from './topology.ts'
export type { ClassicTopology } from './topology.ts'
