import { describe, expect, it } from 'vitest'

import { COLOR_BLUE, COLOR_GREEN, COLOR_RED } from './constants'
import {
  applyOfflineBotMove,
  applyOfflineLocalMove,
  applyOfflinePowerup,
  createOfflineState,
  playOfflineBotTurn,
  startOfflineMatch,
} from './coreAdapter'
import { selectColor } from './engine'
import type { MatchConfig } from './types'

const config: MatchConfig = {
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
})
