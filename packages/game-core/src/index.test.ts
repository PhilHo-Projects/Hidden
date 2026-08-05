import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CLASSIC_V1,
  ENGINE_ID,
  ENGINE_REVISION,
  createTopology,
  clampGameConfig,
  decodeGameConfig,
  DEFAULT_GAME_CONFIG,
  type GameConfig,
  DEFAULT_MATCH_RULES,
  MODE_REGISTRY,
  applyCommand,
  applyTimeout,
  clampMatchRules,
  createGame,
  decodeMatchRules,
  type ApplyResult,
  type ClassicMode,
  type GameCommand,
  type GameSpec,
  type GameState,
  type ModeRegistry,
  type Seat,
} from './index.ts'

const baseSpec = (overrides: Partial<GameSpec> = {}): GameSpec => ({
  engine: { id: ENGINE_ID, revision: ENGINE_REVISION },
  config: DEFAULT_GAME_CONFIG,
  seed: 0x1234abcd,
  firstSeat: 0,
  ...overrides,
})

function accepted(
  state: GameState,
  actor: Seat,
  command: GameCommand,
): ApplyResult {
  const result = applyCommand(state, actor, command)
  assert.equal(result.accepted, true, result.rejection?.reason)
  return result
}

function play(
  state: GameState,
  actor: Seat,
  locationId: number,
  symbol: 'rock' | 'paper' | 'scissors',
) {
  return accepted(state, actor, { type: 'place', locationId, symbol })
}

function mirrorState(state: GameState) {
  return {
    ...state,
    spec: { ...state.spec, firstSeat: (1 - state.spec.firstSeat) as Seat },
    activeSeat: (1 - state.activeSeat) as Seat,
    boards: [state.boards[1], state.boards[0]],
    powerups: [state.powerups[1], state.powerups[0]],
    lastPlacedLocation: [state.lastPlacedLocation[1], state.lastPlacedLocation[0]],
    result: state.result
      ? {
          scores: [state.result.scores[1], state.result.scores[0]],
          winner:
            state.result.winner === null
              ? null
              : ((1 - state.result.winner) as Seat),
        }
      : null,
  }
}

describe('classic@1 registry and construction', () => {
  it('publishes immutable classic mode data with the locked random algorithm', () => {
    assert.equal(MODE_REGISTRY['classic@1'], CLASSIC_V1)
    assert.equal(CLASSIC_V1.randomAlgorithm, 'mulberry32-v1')
    assert.deepEqual(CLASSIC_V1.topology.locationIds, [0, 1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(Object.isFrozen(MODE_REGISTRY), true)
    assert.equal(Object.isFrozen(CLASSIC_V1), true)
    assert.equal(Object.isFrozen(CLASSIC_V1.topology.locationIds), true)
    assert.equal(Object.isFrozen(CLASSIC_V1.topology.winningPatterns), true)
  })

  it('constructs boards from the config topology instead of a nine-cell assumption', () => {
    // Topology now comes from the config rather than an injected registry, so
    // this asserts the same property through the supported entry point.
    const state = configGame({ boardSize: 4, streak: 3 })

    assert.deepEqual(
      state.boards[0].locations.map((location) => location.locationId),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    )
    assert.deepEqual(
      state.boards[1].locations.map((location) => location.locationId),
      state.boards[0].locations.map((location) => location.locationId),
    )
    assert.equal(state.boards[0].locations.length, 16)
  })
})

describe('deterministic immutable command handling', () => {
  it('produces identical seeded timeout states and events', () => {
    const first = applyTimeout(createGame(baseSpec()))
    const second = applyTimeout(createGame(baseSpec()))

    assert.deepEqual(first, second)
    assert.equal(first.accepted, true)
    assert.equal(first.events[0]?.type, 'timeout')
    assert.equal(first.state.turnCount, 1)
  })

  it('does not mutate a frozen input state when applying an accepted command', () => {
    const input = createGame(baseSpec())
    const snapshot = structuredClone(input)
    Object.freeze(input)
    Object.freeze(input.boards)
    Object.freeze(input.boards[0])
    Object.freeze(input.boards[0].locations)

    const result = play(input, 0, 0, 'rock')

    assert.deepEqual(input, snapshot)
    assert.notEqual(result.state, input)
    assert.equal(result.state.boards[0].locations[0]?.symbol, 'rock')
  })

  it('rejects out-of-turn, unknown-location, occupied, and illegal power-up commands without state changes', () => {
    const initial = createGame(baseSpec())
    const outOfTurn = applyCommand(initial, 1, {
      type: 'place',
      locationId: 0,
      symbol: 'rock',
    })
    assert.deepEqual(outOfTurn, {
      accepted: false,
      state: initial,
      events: [],
      rejection: { reason: 'not-active-seat' },
    })

    const unknown = applyCommand(initial, 0, {
      type: 'place',
      locationId: 999,
      symbol: 'paper',
    })
    assert.equal(unknown.accepted, false)
    assert.equal(unknown.rejection?.reason, 'unknown-location')
    assert.equal(unknown.state, initial)

    const afterPlace = play(initial, 0, 0, 'rock').state
    const occupied = applyCommand(afterPlace, 1, {
      type: 'place',
      locationId: 0,
      symbol: 'paper',
    })
    assert.equal(occupied.accepted, true, 'opposing seats may occupy the same location')

    const ownOccupied = applyCommand(afterPlace, 1, {
      type: 'place',
      locationId: 1,
      symbol: 'paper',
    })
    assert.equal(ownOccupied.accepted, true)
    const backToSeatZero = ownOccupied.state
    const repeated = applyCommand(backToSeatZero, 0, {
      type: 'place',
      locationId: 0,
      symbol: 'scissors',
    })
    assert.equal(repeated.accepted, false)
    assert.equal(repeated.rejection?.reason, 'location-occupied')
    assert.equal(repeated.state, backToSeatZero)

    const locked = applyCommand(initial, 0, {
      type: 'activate-powerup',
      powerup: 'shield',
    })
    assert.equal(locked.accepted, false)
    assert.equal(locked.rejection?.reason, 'powerup-locked')
    assert.equal(locked.state, initial)
  })

  it('rejects malformed runtime command inputs without mutating canonical state', () => {
    const initial = createGame(baseSpec())
    const malformedInputs = [
      { actor: 0, command: { type: 'place', locationId: 0, symbol: 'lizard' } },
      { actor: 0, command: { type: 'activate-powerup', powerup: 'teleport' } },
      { actor: 0, command: { type: 'select-shield-target', locationId: '0' } },
      { actor: 0, command: { type: 'unknown-command' } },
      { actor: 2, command: { type: 'timeout' } },
      { actor: 0, command: null },
    ] as const

    for (const input of malformedInputs) {
      const result = applyCommand(
        initial,
        input.actor as Seat,
        input.command as unknown as GameCommand,
      )
      assert.equal(result.accepted, false)
      assert.equal(result.rejection?.reason, 'invalid-command')
      assert.equal(result.state, initial)
      assert.deepEqual(result.events, [])
    }

    assert.deepEqual(initial, createGame(baseSpec()))
  })

  it('resolves the same command stream symmetrically for either first seat', () => {
    let zeroFirst = createGame(baseSpec({ firstSeat: 0 }))
    zeroFirst = play(zeroFirst, 0, 0, 'rock').state
    zeroFirst = play(zeroFirst, 1, 0, 'scissors').state
    zeroFirst = play(zeroFirst, 0, 1, 'paper').state

    let oneFirst = createGame(baseSpec({ firstSeat: 1 }))
    oneFirst = play(oneFirst, 1, 0, 'rock').state
    oneFirst = play(oneFirst, 0, 0, 'scissors').state
    oneFirst = play(oneFirst, 1, 1, 'paper').state

    assert.deepEqual(oneFirst, mirrorState(zeroFirst))
  })
})

describe('classic conflict and turn behavior', () => {
  it('preserves rock-paper-scissors conflicts and consumes shields to destroy the attacker', () => {
    let state = createGame(baseSpec())
    state = play(state, 0, 0, 'rock').state
    const conflict = play(state, 1, 0, 'paper')
    assert.equal(conflict.state.boards[0].locations[0]?.symbol, null)
    assert.equal(conflict.state.boards[1].locations[0]?.symbol, 'paper')
    assert.deepEqual(
      conflict.events.filter((event) => event.type === 'cell-destroyed'),
      [{ type: 'cell-destroyed', seat: 0, locationId: 0, symbol: 'rock' }],
    )

    let shielded = createGame(baseSpec())
    shielded = play(shielded, 0, 0, 'rock').state
    shielded = play(shielded, 1, 3, 'scissors').state
    shielded = play(shielded, 0, 1, 'rock').state
    shielded = play(shielded, 1, 4, 'scissors').state
    shielded = play(shielded, 0, 2, 'rock').state
    shielded = play(shielded, 1, 5, 'scissors').state
    shielded = accepted(shielded, 0, {
      type: 'activate-powerup',
      powerup: 'shield',
    }).state
    shielded = accepted(shielded, 0, {
      type: 'select-shield-target',
      locationId: 0,
    }).state

    const protectedConflict = play(shielded, 0, 6, 'paper').state
    const attacker = play(protectedConflict, 1, 0, 'paper')
    assert.equal(attacker.state.boards[0].locations[0]?.symbol, 'rock')
    assert.equal(attacker.state.boards[0].locations[0]?.immune, false)
    assert.equal(attacker.state.boards[1].locations[0]?.symbol, null)
    assert.equal(
      attacker.events.some(
        (event) => event.type === 'shield-protected' && event.seat === 0,
      ),
      true,
    )
  })

  it('automatically passes a full active board, consumes that turn, and continues', () => {
    // A one-cell board is no longer constructible, so fill a real 3x3 instead:
    // seat 0 plays rock and seat 1 answers with scissors at the same location,
    // so seat 0 keeps every cell and seat 1's board stays empty.
    let state = configGame({ rounds: 20, powerupsEnabled: false })
    for (let locationId = 0; locationId < 8; locationId += 1) {
      state = play(state, 0, locationId, 'rock').state
      state = play(state, 1, locationId, 'scissors').state
    }
    state = play(state, 0, 8, 'rock').state
    assert.equal(
      state.boards[0].locations.every((location) => location.symbol !== null),
      true,
    )

    const result = play(state, 1, 8, 'scissors')

    assert.equal(result.state.turnCount, 19)
    assert.equal(result.state.activeSeat, 1)
    assert.equal(result.state.phase, 'active')
    assert.equal(
      result.events.some(
        (event) => event.type === 'turn-passed' && event.seat === 0,
      ),
      true,
    )
  })
})

describe('classic power-ups and results', () => {
  it('allows other unlocked power-ups while shield target selection remains pending', () => {
    let state = createGame(baseSpec({ config: { ...DEFAULT_GAME_CONFIG, rounds: 20 } }))
    state = play(state, 0, 0, 'rock').state
    state = play(state, 1, 3, 'rock').state
    state = play(state, 0, 1, 'rock').state
    state = play(state, 1, 4, 'rock').state
    state = play(state, 0, 2, 'rock').state
    state = play(state, 1, 5, 'rock').state
    state = play(state, 0, 3, 'paper').state
    state = play(state, 1, 3, 'rock').state
    state = play(state, 0, 4, 'paper').state
    state = play(state, 1, 3, 'rock').state
    state = play(state, 0, 5, 'paper').state
    state = play(state, 1, 0, 'paper').state
    state = play(state, 0, 6, 'scissors').state
    state = play(state, 1, 1, 'paper').state
    state = play(state, 0, 7, 'scissors').state
    state = play(state, 1, 2, 'paper').state
    state = play(state, 0, 8, 'scissors').state
    state = play(state, 1, 3, 'rock').state

    const shield = accepted(state, 0, {
      type: 'activate-powerup',
      powerup: 'shield',
    })
    const reveal = accepted(shield.state, 0, {
      type: 'activate-powerup',
      powerup: 'reveal',
    })
    const extraTurn = accepted(reveal.state, 0, {
      type: 'activate-powerup',
      powerup: 'extraTurn',
    })

    assert.equal(extraTurn.state.powerups[0].shieldSelectionPending, true)
    assert.equal(extraTurn.state.powerups[0].revealActive, true)
    assert.equal(extraTurn.state.powerups[0].extraTurnArmed, true)

    const repeatedShield = applyCommand(extraTurn.state, 0, {
      type: 'activate-powerup',
      powerup: 'shield',
    })
    assert.equal(repeatedShield.accepted, false)
    assert.equal(repeatedShield.rejection?.reason, 'powerup-used')
  })

  it('unlocks, activates, and resolves reveal plus an extra-turn pair as one counted turn', () => {
    let state = createGame(baseSpec({ config: { ...DEFAULT_GAME_CONFIG, rounds: 10 } }))
    state = play(state, 0, 0, 'scissors').state
    state = play(state, 1, 3, 'paper').state
    state = play(state, 0, 1, 'scissors').state
    state = play(state, 1, 4, 'paper').state
    state = play(state, 0, 2, 'scissors').state
    const seatOneUnlock = play(state, 1, 5, 'paper')
    state = seatOneUnlock.state

    assert.equal(state.powerups[0].unlocked.extraTurn, true)
    assert.equal(state.powerups[1].unlocked.reveal, true)

    state = accepted(state, 0, {
      type: 'activate-powerup',
      powerup: 'extraTurn',
    }).state
    const beforePair = state.turnCount
    const first = play(state, 0, 6, 'rock')
    assert.equal(first.state.activeSeat, 0)
    assert.equal(first.state.turnCount, beforePair)
    assert.equal(first.state.pendingExtraPlacements.length, 1)

    const second = play(first.state, 0, 7, 'paper')
    assert.equal(second.state.activeSeat, 1)
    assert.equal(second.state.turnCount, beforePair + 1)
    assert.deepEqual(
      second.events.find((event) => event.type === 'placements-committed'),
      {
        type: 'placements-committed',
        seat: 0,
        placements: [
          { locationId: 6, symbol: 'rock' },
          { locationId: 7, symbol: 'paper' },
        ],
      },
    )

    const reveal = accepted(second.state, 1, {
      type: 'activate-powerup',
      powerup: 'reveal',
    })
    assert.equal(reveal.state.powerups[1].revealActive, true)
    const placed = play(reveal.state, 1, 6, 'rock')
    assert.equal(placed.state.powerups[1].revealActive, false)
  })

  it('uses seeded timeout choices, including completing pending shield selection', () => {
    let state = createGame(baseSpec({ seed: 1, config: { ...DEFAULT_GAME_CONFIG, rounds: 10 } }))
    state = play(state, 0, 0, 'rock').state
    state = play(state, 1, 3, 'scissors').state
    state = play(state, 0, 1, 'rock').state
    state = play(state, 1, 4, 'scissors').state
    state = play(state, 0, 2, 'rock').state
    state = play(state, 1, 5, 'scissors').state
    state = accepted(state, 0, {
      type: 'activate-powerup',
      powerup: 'shield',
    }).state

    const result = applyTimeout(state)

    assert.equal(result.accepted, true)
    assert.equal(result.state.powerups[0].shieldSelectionPending, false)
    assert.equal(
      result.state.boards[0].locations.some((location) => location.immune),
      true,
    )
    assert.equal(result.state.turnCount, state.turnCount + 1)
  })

  it('finishes at the configured turn limit with seat-neutral scores, winner, and ties', () => {
    let win = createGame(baseSpec({ config: { ...DEFAULT_GAME_CONFIG, rounds: 1 } }))
    win = play(win, 0, 0, 'rock').state
    const finished = play(win, 1, 1, 'paper')
    assert.equal(finished.state.phase, 'finished')
    assert.deepEqual(finished.state.result, { scores: [1, 1], winner: null })
    assert.deepEqual(finished.events.at(-1), {
      type: 'game-finished',
      scores: [1, 1],
      winner: null,
    })

    let decisive = createGame(baseSpec({ config: { ...DEFAULT_GAME_CONFIG, rounds: 1 } }))
    decisive = play(decisive, 0, 0, 'rock').state
    const loss = play(decisive, 1, 0, 'scissors')
    assert.deepEqual(loss.state.result, { scores: [1, 0], winner: 0 })
  })
})

describe('shared match rules', () => {
  it('decodes complete rules and rejects malformed rules', () => {
    assert.deepEqual(
      decodeMatchRules({ rounds: 8, turnSeconds: 15, blindMode: false }),
      { rounds: 8, turnSeconds: 15, blindMode: false },
    )
    assert.equal(decodeMatchRules({ rounds: 8, turnSeconds: '15', blindMode: false }), undefined)
  })

  it('clamps finite numeric rules and defaults invalid fields independently', () => {
    assert.deepEqual(
      clampMatchRules({ rounds: 999, turnSeconds: 0, blindMode: false }),
      { rounds: 20, turnSeconds: 2, blindMode: false },
    )
    assert.deepEqual(
      clampMatchRules({ rounds: Number.NaN, turnSeconds: 'fast', blindMode: 1 }),
      DEFAULT_MATCH_RULES,
    )
  })
})

// Written as a literal rather than imported from CLASSIC_V1 so it keeps
// guarding the 3x3 board after the mode registry is deleted.
const LEGACY_3X3_PATTERNS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

describe('topology generation', () => {
  it('reproduces the legacy 3x3 topology exactly, including pattern order', () => {
    const topology = createTopology(3, 3)
    assert.deepEqual(topology.locationIds, [0, 1, 2, 3, 4, 5, 6, 7, 8])
    assert.deepEqual(topology.winningPatterns, LEGACY_3X3_PATTERNS)
  })

  it('numbers every cell of a larger board', () => {
    assert.equal(createTopology(4, 3).locationIds.length, 16)
    assert.equal(createTopology(5, 3).locationIds.length, 25)
  })

  it('emits every sliding window of the requested streak length', () => {
    // 4x4 streak 4: 4 rows + 4 columns + 1 diagonal each way.
    assert.equal(createTopology(4, 4).winningPatterns.length, 10)
    // 4x4 streak 3: 4 rows x 2 + 4 columns x 2 + 4 diagonals each way.
    assert.equal(createTopology(4, 3).winningPatterns.length, 24)
  })

  it('produces patterns of exactly the streak length', () => {
    for (const pattern of createTopology(5, 4).winningPatterns) {
      assert.equal(pattern.length, 4)
    }
  })

  it('rejects a streak that cannot fit on the board', () => {
    assert.throws(() => createTopology(3, 4), /streak/i)
    assert.throws(() => createTopology(3, 1), /streak/i)
  })

  it('exposes the engine identity', () => {
    assert.equal(ENGINE_ID, 'classic')
    assert.equal(ENGINE_REVISION, 1)
  })
})

describe('game config', () => {
  it('defaults to the game as it plays today', () => {
    assert.deepEqual(DEFAULT_GAME_CONFIG, {
      boardSize: 3,
      streak: 3,
      rounds: 6,
      turnSeconds: 10,
      blindMode: true,
      powerupsEnabled: true,
      powerups: { shield: true, reveal: true, extraTurn: true },
      powerupBySymbol: { rock: 'shield', paper: 'reveal', scissors: 'extraTurn' },
      forbidImmediateRepeat: false,
    })
  })

  it('decodes a complete config', () => {
    const decoded = decodeGameConfig({
      boardSize: 5,
      streak: 4,
      rounds: 12,
      turnSeconds: 15,
      blindMode: false,
      powerupsEnabled: false,
      powerups: { shield: false, reveal: true, extraTurn: false },
      powerupBySymbol: { rock: 'reveal', paper: 'shield', scissors: 'extraTurn' },
      forbidImmediateRepeat: true,
    })
    assert.equal(decoded?.boardSize, 5)
    assert.equal(decoded?.streak, 4)
    assert.equal(decoded?.powerupsEnabled, false)
    assert.equal(decoded?.powerups.reveal, true)
    assert.equal(decoded?.powerupBySymbol.rock, 'reveal')
    assert.equal(decoded?.forbidImmediateRepeat, true)
  })

  it('fills missing fields from defaults instead of failing', () => {
    // A stale client must degrade to the default game, not fail to join.
    assert.deepEqual(decodeGameConfig({ boardSize: 4 }), {
      ...DEFAULT_GAME_CONFIG,
      boardSize: 4,
    })
  })

  it('rejects values that are not objects', () => {
    for (const value of [null, undefined, 7, 'config', []]) {
      assert.equal(decodeGameConfig(value), undefined)
    }
  })

  it('clamps every numeric field into range', () => {
    const clamped = clampGameConfig({
      boardSize: 9,
      streak: 99,
      rounds: 999,
      turnSeconds: 0,
    })
    assert.equal(clamped.boardSize, 5)
    assert.equal(clamped.rounds, 20)
    assert.equal(clamped.turnSeconds, 2)
    assert.equal(clamped.streak, 5)
  })

  it('clamps streak against the clamped board size, not the requested one', () => {
    assert.equal(clampGameConfig({ boardSize: 3, streak: 5 }).streak, 3)
  })

  it('coerces malformed booleans and power-up maps to defaults', () => {
    const clamped = clampGameConfig({
      blindMode: 'yes',
      powerupsEnabled: 1,
      powerups: { shield: 'no' },
      powerupBySymbol: { rock: 'nonsense' },
    })
    assert.equal(clamped.blindMode, true)
    assert.equal(clamped.powerupsEnabled, true)
    assert.equal(clamped.powerups.shield, true)
    assert.equal(clamped.powerupBySymbol.rock, 'shield')
  })
})

const configGame = (overrides: Partial<GameConfig> = {}, seed = 1): GameState =>
  createGame({
    engine: { id: 'classic', revision: 1 },
    config: clampGameConfig({ ...DEFAULT_GAME_CONFIG, ...overrides }),
    seed,
    firstSeat: 0,
  })

const put = (state: GameState, seat: Seat, locationId: number, symbol: 'rock' | 'paper' | 'scissors') =>
  applyCommand(state, seat, { type: 'place', locationId, symbol })

describe('config-driven engine', () => {
  it('produces the default game from the default config', () => {
    const game = createGame(baseSpec())
    assert.deepEqual(game.config, DEFAULT_GAME_CONFIG)
    assert.equal(game.boards[0].locations.length, 9)
  })

  it('builds a board sized by the config', () => {
    assert.equal(configGame({ boardSize: 5, streak: 4 }).boards[0].locations.length, 25)
    assert.equal(configGame({ boardSize: 4, streak: 3 }).boards[1].locations.length, 16)
  })

  it('rejects a spec from a different engine revision', () => {
    assert.throws(
      () =>
        createGame({
          engine: { id: 'classic', revision: 2 },
          config: DEFAULT_GAME_CONFIG,
          seed: 1,
          firstSeat: 0,
        }),
      /engine/i,
    )
  })

  it('never unlocks a power-up when power-ups are disabled', () => {
    // streak 2 means a line forms after the seat's second adjacent placement.
    let state = configGame({ powerupsEnabled: false, streak: 2 })
    state = put(state, 0, 0, 'rock').state
    state = put(state, 1, 8, 'paper').state
    const unlock = put(state, 0, 1, 'rock')
    assert.equal(
      unlock.events.some((event) => event.type === 'powerup-unlocked'),
      false,
    )
    assert.equal(unlock.state.powerups[0].unlocked.shield, false)
  })

  it('rejects activating a power-up when power-ups are disabled', () => {
    const result = applyCommand(configGame({ powerupsEnabled: false }), 0, {
      type: 'activate-powerup',
      powerup: 'shield',
    })
    assert.equal(result.accepted, false)
    assert.equal(result.rejection?.reason, 'powerup-locked')
  })

  it('never unlocks an individually disabled power-up', () => {
    let state = configGame({
      streak: 2,
      powerups: { shield: false, reveal: true, extraTurn: true },
    })
    state = put(state, 0, 0, 'rock').state
    state = put(state, 1, 8, 'paper').state
    const unlock = put(state, 0, 1, 'rock')
    assert.equal(
      unlock.events.some((event) => event.type === 'powerup-unlocked'),
      false,
    )
  })

  it('still unlocks an enabled power-up when a different one is disabled', () => {
    let state = configGame({
      streak: 2,
      powerups: { shield: false, reveal: true, extraTurn: true },
    })
    state = put(state, 0, 0, 'paper').state
    state = put(state, 1, 8, 'rock').state
    const unlock = put(state, 0, 1, 'paper')
    assert.deepEqual(
      unlock.events.filter((event) => event.type === 'powerup-unlocked'),
      [{ type: 'powerup-unlocked', seat: 0, powerup: 'reveal' }],
    )
  })

  it('bars a seat from replaying its own previous location when configured', () => {
    let state = configGame({ forbidImmediateRepeat: true, powerupsEnabled: false })
    state = put(state, 0, 4, 'rock').state
    state = put(state, 1, 4, 'paper').state
    // Seat 0's rock lost to paper, so location 4 is empty on its board again.
    const repeat = put(state, 0, 4, 'scissors')
    assert.equal(repeat.accepted, false)
    assert.equal(repeat.rejection?.reason, 'repeat-location')
  })

  it('permits the same location once a turn has passed', () => {
    let state = configGame({ forbidImmediateRepeat: true, powerupsEnabled: false })
    state = put(state, 0, 4, 'rock').state
    state = put(state, 1, 4, 'paper').state
    state = put(state, 0, 0, 'rock').state
    state = put(state, 1, 1, 'rock').state
    assert.equal(put(state, 0, 4, 'rock').accepted, true)
  })

  it('allows repeats when the rule is off', () => {
    let state = configGame({ forbidImmediateRepeat: false, powerupsEnabled: false })
    state = put(state, 0, 4, 'rock').state
    state = put(state, 1, 4, 'paper').state
    assert.equal(put(state, 0, 4, 'scissors').accepted, true)
  })

  it('is deterministic for a given seed, config, and command list', () => {
    const run = () => {
      let state = configGame({ boardSize: 4, streak: 3 }, 99)
      for (let index = 0; index < 8; index += 1) {
        state = applyTimeout(state).state
      }
      return JSON.stringify(state)
    }
    assert.equal(run(), run())
  })
})
