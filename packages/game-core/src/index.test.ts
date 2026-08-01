import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CLASSIC_V1,
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
  mode: { id: 'classic', revision: 1 },
  rules: { rounds: 6, turnSeconds: 10, blindMode: true },
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

  it('constructs boards from injected topology location IDs instead of a nine-cell assumption', () => {
    const alternateClassic: ClassicMode = {
      ...CLASSIC_V1,
      topology: {
        locationIds: [10, 20, 40, 80],
        winningPatterns: [[10, 20]],
      },
    }
    const registry: ModeRegistry = { 'classic@1': alternateClassic }

    const state = createGame(baseSpec(), registry)

    assert.deepEqual(
      state.boards[0].locations.map((location) => location.locationId),
      [10, 20, 40, 80],
    )
    assert.deepEqual(
      state.boards[1].locations.map((location) => location.locationId),
      [10, 20, 40, 80],
    )
    assert.equal(state.boards[0].locations.length, 4)
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
    const singleLocationMode: ClassicMode = {
      ...CLASSIC_V1,
      topology: { locationIds: [7], winningPatterns: [[7]] },
    }
    const registry: ModeRegistry = { 'classic@1': singleLocationMode }
    let state = createGame(baseSpec({ rules: { ...DEFAULT_MATCH_RULES, rounds: 2 } }), registry)
    state = play(state, 0, 7, 'rock').state

    const result = play(state, 1, 7, 'scissors')

    assert.equal(result.state.turnCount, 3)
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
    let state = createGame(baseSpec({ rules: { ...DEFAULT_MATCH_RULES, rounds: 20 } }))
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
    let state = createGame(baseSpec({ rules: { ...DEFAULT_MATCH_RULES, rounds: 10 } }))
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
    let state = createGame(baseSpec({ seed: 1, rules: { ...DEFAULT_MATCH_RULES, rounds: 10 } }))
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
    let win = createGame(baseSpec({ rules: { ...DEFAULT_MATCH_RULES, rounds: 1 } }))
    win = play(win, 0, 0, 'rock').state
    const finished = play(win, 1, 1, 'paper')
    assert.equal(finished.state.phase, 'finished')
    assert.deepEqual(finished.state.result, { scores: [1, 1], winner: null })
    assert.deepEqual(finished.events.at(-1), {
      type: 'game-finished',
      scores: [1, 1],
      winner: null,
    })

    let decisive = createGame(baseSpec({ rules: { ...DEFAULT_MATCH_RULES, rounds: 1 } }))
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
