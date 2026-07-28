import { COLOR_BLUE, COLOR_GREEN, COLOR_RED } from '../constants'
import {
  activatePowerup,
  applyLocalMove,
  applyRemoteImmuneStatus,
  applyRemoteMove,
  createInitialState,
  forceTimeoutAction,
  selectColor,
} from '../engine'
import type { MatchConfig } from '../types'

const baseConfig: MatchConfig = {
  rounds: 3,
  turnSeconds: 10,
  isOnline: true,
  hasAI: false,
  blindMode: true,
}

describe('hidden engine', () => {
  it('clears both cells on same-color conflict', () => {
    const state = createInitialState(baseConfig)
    state.phase = 'battle'
    state.playerGrid.cells[0] = { occupied: true, color: COLOR_GREEN, immune: false }
    const result = applyRemoteMove(state, 0, COLOR_GREEN)

    expect(result.state.playerGrid.cells[0].occupied).toBe(false)
    expect(result.state.opponentGrid.cells[0].occupied).toBe(false)
  })

  it('consumes immunity and clears the opposing cell', () => {
    const state = createInitialState(baseConfig)
    state.phase = 'battle'
    state.playerGrid.cells[0] = { occupied: true, color: COLOR_GREEN, immune: true }
    const result = applyRemoteMove(state, 0, COLOR_BLUE)

    expect(result.state.playerGrid.cells[0].occupied).toBe(true)
    expect(result.state.playerGrid.cells[0].immune).toBe(false)
    expect(result.state.opponentGrid.cells[0].occupied).toBe(false)
  })

  it('unlocks shield after making a green line', () => {
    let state = createInitialState(baseConfig)
    state.phase = 'battle'
    state.playerGrid.cells[0] = { occupied: true, color: COLOR_GREEN, immune: false }
    state.playerGrid.cells[1] = { occupied: true, color: COLOR_GREEN, immune: false }
    state = selectColor(state, COLOR_GREEN)

    const result = applyLocalMove(state, 2)

    expect(result.state.playerPowerups.unlocked.shield).toBe(true)
  })

  it('arms and resolves an extra turn as a batched packet', () => {
    const state = createInitialState(baseConfig)
    state.phase = 'battle'
    state.playerPowerups.unlocked.extraTurn = true

    const activation = activatePowerup(state, 'extraTurn')
    const firstMove = applyLocalMove(selectColor(activation.state, COLOR_RED), 0)

    expect(firstMove.state.isMyTurn).toBe(true)
    expect(firstMove.state.isInExtraTurn).toBe(true)

    const secondMove = applyLocalMove(selectColor(firstMove.state, COLOR_GREEN), 1)
    const sendMovesEvent = secondMove.events.find((event) => event.type === 'send-moves')

    expect(sendMovesEvent).toBeTruthy()
    expect(secondMove.state.isInExtraTurn).toBe(false)
  })

  it('applies remote immune indices to the opponent grid', () => {
    const state = createInitialState(baseConfig)
    const result = applyRemoteImmuneStatus(state, [1, 4])

    expect(result.state.opponentGrid.cells[1].immune).toBe(true)
    expect(result.state.opponentGrid.cells[4].immune).toBe(true)
  })

  it('forces a shield then a move when the timer expires in shield mode', () => {
    const state = createInitialState(baseConfig)
    state.phase = 'battle'
    state.playerPowerups.unlocked.shield = true
    state.playerPowerups.used.shield = true
    state.shieldSelectionMode = true
    state.playerGrid.cells[0] = { occupied: true, color: COLOR_GREEN, immune: false }

    const randomValues = [0, 0.4, 0.8]
    const result = forceTimeoutAction(state, () => randomValues.shift() ?? 0)

    expect(result.state.playerGrid.cells[0].immune).toBe(true)
    expect(result.state.totalTurns).toBe(1)
  })
})
