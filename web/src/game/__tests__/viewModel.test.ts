import { describe, expect, it } from 'vitest'
import {
  createGuestName,
  getBackTarget,
  getOpponentName,
  getScoreCountLabels,
  getScreenLabel,
  resolvePlayerName,
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
    expect(getScreenLabel('account')).toBe('Account')
    expect(getScreenLabel('mode-select')).toBe('Play')
    expect(getScreenLabel('online-menu')).toBe('Online')
    expect(getScreenLabel('matchmaking')).toBe('Searching')
    expect(getScreenLabel('battle')).toBe('Battle')
  })

  it('creates a four-digit guest identity from the supplied random source', () => {
    expect(createGuestName(() => 0)).toBe('Guest#0000')
    expect(createGuestName(() => 0.48219)).toBe('Guest#4821')
    expect(createGuestName(() => 0.99999)).toBe('Guest#9999')
  })

  it('uses a signed-in account name before the generated guest identity', () => {
    expect(resolvePlayerName('HiddenPlayer', 'Guest#4821')).toBe('HiddenPlayer')
    expect(resolvePlayerName(undefined, 'Guest#4821')).toBe('Guest#4821')
  })

  it('returns to the previous pre-game decision without skipping home', () => {
    expect(getBackTarget('account')).toBe('intro')
    expect(getBackTarget('mode-select')).toBe('intro')
    expect(getBackTarget('online-menu')).toBe('mode-select')
    expect(getBackTarget('offline-setup')).toBe('mode-select')
    expect(getBackTarget('matchmaking')).toBe('online-menu')
    expect(getBackTarget('ready')).toBe('online-menu')
    expect(getBackTarget('countdown', false)).toBe('offline-setup')
    expect(getBackTarget('battle', false)).toBe('offline-setup')
    expect(getBackTarget('results', false)).toBe('offline-setup')
    expect(getBackTarget('countdown', true)).toBe('online-menu')
    expect(getBackTarget('battle', true)).toBe('online-menu')
    expect(getBackTarget('results', true)).toBe('online-menu')
    expect(getBackTarget('disconnected', true)).toBe('online-menu')
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

  it('assigns sequential score labels only to occupied cells', () => {
    const cells = Array.from({ length: 9 }, (_, index) => ({
      occupied: index === 1 || index === 4 || index === 8,
      color: index === 1 || index === 4 || index === 8 ? '#4591DB' as const : null,
      immune: false,
    }))

    expect(getScoreCountLabels(cells)).toEqual({ 1: 1, 4: 2, 8: 3 })
  })
})
