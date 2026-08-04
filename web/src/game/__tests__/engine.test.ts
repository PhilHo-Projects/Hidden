import { DEFAULT_GAME_CONFIG } from '@hidden/game-core'
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
  ...DEFAULT_GAME_CONFIG,
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
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'cell-destroyed', board: 'player', index: 0 }),
        expect.objectContaining({ type: 'cell-destroyed', board: 'opponent', index: 0 }),
      ]),
    )
  })

  it('reports whose cell was destroyed when the player wins a conflict', () => {
    const state = createInitialState(baseConfig)
    state.phase = 'battle'
    state.opponentGrid.cells[3] = { occupied: true, color: COLOR_RED, immune: false }

    const result = applyLocalMove(selectColor(state, COLOR_GREEN), 3)

    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'cell-destroyed', board: 'opponent', index: 3 }),
      ]),
    )
    expect(result.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'cell-destroyed', board: 'player', index: 3 }),
      ]),
    )
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

  it('clears reveal after the player places a piece', () => {
    const state = createInitialState(baseConfig)
    state.phase = 'battle'
    state.playerPowerups.unlocked.reveal = true

    const activation = activatePowerup(state, 'reveal')
    const result = applyLocalMove(selectColor(activation.state, COLOR_BLUE), 4)

    expect(activation.state.playerPowerups.revealActive).toBe(true)
    expect(result.state.playerPowerups.revealActive).toBe(false)
    expect(result.state.playerGrid.cells[4]).toEqual({
      occupied: true,
      color: COLOR_BLUE,
      immune: false,
    })
  })

  it('counts an extra-turn pair as one turn and sends both placements together', () => {
    const state = createInitialState(baseConfig)
    state.phase = 'battle'
    state.playerPowerups.unlocked.extraTurn = true

    const activation = activatePowerup(state, 'extraTurn')
    const firstMove = applyLocalMove(selectColor(activation.state, COLOR_RED), 0)
    const secondMove = applyLocalMove(selectColor(firstMove.state, COLOR_GREEN), 1)

    expect(firstMove.state.totalTurns).toBe(0)
    expect(firstMove.state.isMyTurn).toBe(true)
    expect(secondMove.state.totalTurns).toBe(1)
    expect(secondMove.state.isMyTurn).toBe(false)
    expect(secondMove.events).toEqual(
      expect.arrayContaining([
        {
          type: 'send-moves',
          moves: [
            { index: 0, color: COLOR_RED },
            { index: 1, color: COLOR_GREEN },
          ],
        },
      ]),
    )
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

  it('advances the turn after a timed-out player receives a random placement', () => {
    const state = createInitialState(baseConfig)
    state.phase = 'battle'

    const result = forceTimeoutAction(state, () => 0.5)

    expect(result.state.playerGrid.cells[4]).toEqual({
      occupied: true,
      color: COLOR_BLUE,
      immune: false,
    })
    expect(result.state.totalTurns).toBe(1)
    expect(result.state.currentRound).toBe(1)
    expect(result.state.isMyTurn).toBe(false)
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'announcement', message: 'Timer expired!' }),
        { type: 'send-move', index: 4, color: COLOR_BLUE },
      ]),
    )
  })

  it.each([
    {
      name: 'win',
      playerIndexes: [0, 1],
      opponentIndexes: [],
      expected: { playerScore: 2, opponentScore: 1, outcome: 'win' },
    },
    {
      name: 'loss',
      playerIndexes: [0],
      opponentIndexes: [1],
      expected: { playerScore: 1, opponentScore: 2, outcome: 'loss' },
    },
    {
      name: 'tie',
      playerIndexes: [0],
      opponentIndexes: [],
      expected: { playerScore: 1, opponentScore: 1, outcome: 'tie' },
    },
  ])('calculates the final $name score and outcome', ({ playerIndexes, opponentIndexes, expected }) => {
    const state = createInitialState({ ...baseConfig, rounds: 1 })
    state.phase = 'battle'
    state.totalTurns = 1

    for (const index of playerIndexes) {
      state.playerGrid.cells[index] = { occupied: true, color: COLOR_GREEN, immune: false }
    }
    for (const index of opponentIndexes) {
      state.opponentGrid.cells[index] = { occupied: true, color: COLOR_RED, immune: false }
    }

    const result = applyRemoteMove(state, 8, COLOR_BLUE)

    expect(result.state.phase).toBe('results')
    expect(result.state.result).toEqual(expected)
    expect(result.events).toEqual(
      expect.arrayContaining([{ type: 'game-over', result: expected }]),
    )
  })
})
