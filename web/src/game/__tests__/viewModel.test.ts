import { describe, expect, it } from 'vitest'
import {
  getOpponentName,
  getScreenLabel,
  normalizeUsername,
  shouldShowOpponentBoard,
} from '../viewModel'
import type { GameState } from '../types'

const makeMatch = (overrides: Partial<GameState> = {}): GameState => ({
  config: {
    rounds: 6,
    turnSeconds: 10,
    isOnline: false,
    hasAI: true,
    blindMode: true,
  },
  phase: 'battle',
  playerGrid: { cells: [] },
  opponentGrid: { cells: [] },
  isMyTurn: true,
  currentRound: 1,
  totalTurns: 0,
  maxTurns: 12,
  selectedColor: null,
  shieldSelectionMode: false,
  playerPowerups: {
    unlocked: { shield: false, reveal: false, extraTurn: false },
    used: { shield: false, reveal: false, extraTurn: false },
    revealActive: false,
    extraTurnArmed: false,
  },
  pendingExtraTurnMoves: [],
  isInExtraTurn: false,
  result: null,
  ...overrides,
})

describe('view model helpers', () => {
  it('uses Hidden route labels', () => {
    expect(getScreenLabel('intro')).toBe('Hidden')
    expect(getScreenLabel('matchmaking')).toBe('Searching')
    expect(getScreenLabel('battle')).toBe('Battle')
  })

  it('normalizes display names before they enter game flows', () => {
    expect(normalizeUsername('  EchoStrike  ')).toBe('EchoStrike')
    expect(normalizeUsername('   ')).toBe('')
  })

  it('chooses the visible opponent name from online users before fallbacks', () => {
    expect(
      getOpponentName(
        [
          { userId: 1, userName: 'CodeJunkie' },
          { userId: 2, userName: 'EchoStrike' },
        ],
        1,
        makeMatch(),
      ),
    ).toBe('EchoStrike')

    expect(getOpponentName([], null, makeMatch())).toBe('Practice Bot')
    expect(getOpponentName([], 1, makeMatch({ config: { ...makeMatch().config, hasAI: false } }))).toBe('Opponent')
  })

  it('reveals the opponent board only when the current mode allows it', () => {
    expect(shouldShowOpponentBoard(null, 'intro')).toBe(false)
    expect(shouldShowOpponentBoard(makeMatch(), 'battle')).toBe(false)
    expect(
      shouldShowOpponentBoard(
        makeMatch({
          playerPowerups: {
            unlocked: { shield: false, reveal: true, extraTurn: false },
            used: { shield: false, reveal: true, extraTurn: false },
            revealActive: true,
            extraTurnArmed: false,
          },
        }),
        'battle',
      ),
    ).toBe(true)
    expect(shouldShowOpponentBoard(makeMatch(), 'results')).toBe(true)
    expect(shouldShowOpponentBoard(makeMatch({ config: { ...makeMatch().config, blindMode: false } }), 'battle')).toBe(true)
  })
})
