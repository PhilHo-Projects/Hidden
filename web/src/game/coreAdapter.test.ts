import { DEFAULT_GAME_CONFIG } from '@hidden/game-core'
import { describe, expect, it } from 'vitest'

import { COLOR_BLUE, COLOR_GREEN, COLOR_RED } from './constants'
import {
  applyOnlinePresentation,
  applyOfflineBotMove,
  applyOfflineLocalMove,
  applyOfflinePowerup,
  createOfflineState,
  createOnlinePresentedState,
  playOfflineBotTurn,
  selectColor,
  startOfflineMatch,
} from './coreAdapter'
import { applyCommand, createGame } from '@hidden/game-core'
import type { MatchConfig } from './types'

const config: MatchConfig = {
  ...DEFAULT_GAME_CONFIG,
  rounds: 6,
  turnSeconds: 10,
  blindMode: true,
  isOnline: false,
  hasAI: true,
}

describe('offline core presentation adapter', () => {
  it('maps canonical local seats and symbols into player colors without relay events', () => {
    const setup = createOfflineState(config, true, 123)
    const started = startOfflineMatch(setup)
    const selected = selectColor(started.state, COLOR_GREEN)

    const result = applyOfflineLocalMove(selected, 0)

    expect(result.state.playerGrid.cells[0]).toEqual({
      occupied: true,
      color: COLOR_GREEN,
      immune: false,
    })
    expect(result.state.opponentGrid.cells[0]).toEqual({
      occupied: false,
      color: null,
      immune: false,
    })
    expect(result.state.isMyTurn).toBe(false)
    expect(result.state.totalTurns).toBe(1)
    expect(result.events.some((event) => event.type.startsWith('send-'))).toBe(false)
  })

  it('resolves bot commands through the canonical opponent seat immediately', () => {
    let state = startOfflineMatch(createOfflineState(config, true, 456)).state
    state = applyOfflineLocalMove(selectColor(state, COLOR_BLUE), 0).state

    const result = applyOfflineBotMove(state, 1, COLOR_RED)

    expect(result.state.opponentGrid.cells[1]).toEqual({
      occupied: true,
      color: COLOR_RED,
      immune: false,
    })
    expect(result.state.isMyTurn).toBe(true)
    expect(result.state.totalTurns).toBe(2)
  })

  it('maps canonical conflict destruction and unlock events to current animation and announcement events', () => {
    let state = startOfflineMatch(createOfflineState(config, true, 789)).state
    state = applyOfflineLocalMove(selectColor(state, COLOR_GREEN), 0).state
    state = applyOfflineBotMove(state, 3, COLOR_BLUE).state
    state = applyOfflineLocalMove(selectColor(state, COLOR_GREEN), 1).state
    state = applyOfflineBotMove(state, 4, COLOR_BLUE).state
    const unlock = applyOfflineLocalMove(selectColor(state, COLOR_GREEN), 2)

    expect(unlock.state.playerPowerups.unlocked.shield).toBe(true)
    expect(unlock.events).toContainEqual({
      type: 'announcement',
      message: 'Shield unlocked!',
    })

    state = applyOfflineBotMove(unlock.state, 5, COLOR_RED).state
    const conflict = applyOfflineLocalMove(selectColor(state, COLOR_GREEN), 5)
    expect(conflict.events).toContainEqual({
      type: 'cell-destroyed',
      board: 'opponent',
      index: 5,
      color: COLOR_RED,
    })
  })

  it('keeps extra-turn presentation immediate and lets the seeded core choose bot placements', () => {
    let state = startOfflineMatch(createOfflineState({ ...config, rounds: 10 }, true, 42)).state
    state = applyOfflineLocalMove(selectColor(state, COLOR_RED), 0).state
    state = applyOfflineBotMove(state, 3, COLOR_GREEN).state
    state = applyOfflineLocalMove(selectColor(state, COLOR_RED), 1).state
    state = applyOfflineBotMove(state, 4, COLOR_GREEN).state
    state = applyOfflineLocalMove(selectColor(state, COLOR_RED), 2).state
    state = applyOfflineBotMove(state, 5, COLOR_GREEN).state

    const activation = applyOfflinePowerup(state, 'extraTurn')
    const first = applyOfflineLocalMove(selectColor(activation.state, COLOR_GREEN), 6)
    expect(first.state.isMyTurn).toBe(true)
    expect(first.state.isInExtraTurn).toBe(true)
    expect(first.state.totalTurns).toBe(6)

    const second = applyOfflineLocalMove(selectColor(first.state, COLOR_BLUE), 7)
    expect(second.state.isMyTurn).toBe(false)
    expect(second.state.isInExtraTurn).toBe(false)
    expect(second.state.totalTurns).toBe(7)

    const bot = playOfflineBotTurn(second.state)
    expect(bot.state.isMyTurn).toBe(true)
    expect(bot.state.totalTurns).toBe(8)
    expect(bot.events).not.toContainEqual({
      type: 'announcement',
      message: 'Timer expired!',
    })
  })

  /*
   * The core reports a winning seat; the presentation layer has to turn that
   * into a verdict for whichever seat is local, so seat 1 must read the same
   * scoreline as a loss that seat 0 reads as a win. Covered here because the
   * only previous test of this mapping belonged to the deleted legacy engine.
   */
  it.each([
    { name: 'win', localSeat: 0 as const, outcome: 'win' },
    { name: 'loss', localSeat: 1 as const, outcome: 'loss' },
  ])('reports a decided game as a $name from that seat', ({ localSeat, outcome }) => {
    // rounds: 1 -> maxTurns 2, one placement each. Both contest location 0,
    // where rock beats scissors: seat 1's piece is destroyed and seat 0's
    // survives, so the game ends 1-0 rather than in a draw.
    let canonical = createGame({
      engine: { id: 'classic', revision: 1 },
      config: { ...config, rounds: 1 },
      seed: 7,
      firstSeat: 0,
    })
    const placed = applyCommand(canonical, 0, {
      type: 'place', locationId: 0, symbol: 'rock',
    })
    if (!placed.accepted) throw new Error('Fixture placement must be accepted.')
    canonical = placed.state
    const closed = applyCommand(canonical, 1, {
      type: 'place', locationId: 0, symbol: 'scissors',
    })
    if (!closed.accepted) throw new Error('Fixture placement must be accepted.')

    expect(closed.state.result?.scores).toEqual([1, 0])

    expect(closed.state.phase).toBe('finished')
    expect(closed.state.result?.winner).toBe(0)

    const presented = createOnlinePresentedState(
      { ...config, rounds: 1, isOnline: true, hasAI: false },
      closed.state,
      localSeat,
    )

    expect(presented.result?.outcome).toBe(outcome)
  })

  it('reports an even scoreline as a tie from both seats', () => {
    let canonical = createGame({
      engine: { id: 'classic', revision: 1 },
      config: { ...config, rounds: 1 },
      seed: 7,
      firstSeat: 0,
    })
    const first = applyCommand(canonical, 0, {
      type: 'place', locationId: 0, symbol: 'rock',
    })
    if (!first.accepted) throw new Error('Fixture placement must be accepted.')
    canonical = first.state
    const second = applyCommand(canonical, 1, {
      type: 'place', locationId: 4, symbol: 'paper',
    })
    if (!second.accepted) throw new Error('Fixture placement must be accepted.')

    expect(second.state.result?.winner).toBeNull()

    for (const localSeat of [0, 1] as const) {
      const presented = createOnlinePresentedState(
        { ...config, rounds: 1, isOnline: true, hasAI: false },
        second.state,
        localSeat,
      )
      expect(presented.result?.outcome).toBe('tie')
    }
  })
})

describe('online core presentation adapter', () => {
  it('presents the server-created canonical state without local relay events', () => {
    const canonical = createGame({
      engine: { id: 'classic', revision: 1 },
      config,
      seed: 42,
      firstSeat: 1,
    })
    const state = createOnlinePresentedState(
      { ...config, isOnline: true, hasAI: false },
      canonical,
      0,
    )

    expect(state.phase).toBe('setup')
    expect(state.isMyTurn).toBe(false)
    expect(state.canonicalState).toBe(canonical)
    expect(state.localSeat).toBe(0)
  })

  it('maps accepted server effects and never creates legacy send events', () => {
    const canonical = createGame({
      engine: { id: 'classic', revision: 1 },
      config,
      seed: 42,
      firstSeat: 0,
    })
    const state = {
      ...createOnlinePresentedState(
        { ...config, isOnline: true, hasAI: false },
        canonical,
        0,
      ),
      phase: 'battle' as const,
      selectedColor: COLOR_GREEN,
    }
    const accepted = applyCommand(canonical, 0, {
      type: 'place', locationId: 0, symbol: 'rock',
    })
    if (!accepted.accepted) throw new Error('Fixture command must be accepted.')

    const result = applyOnlinePresentation(
      state,
      accepted.state,
      accepted.events,
      true,
    )

    expect(result.state.playerGrid.cells[0]?.color).toBe(COLOR_GREEN)
    expect(result.state.selectedColor).toBeNull()
    expect(result.events.some((event) => event.type.startsWith('send-'))).toBe(false)
  })
})
