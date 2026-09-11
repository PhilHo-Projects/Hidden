import {
  clampGameConfig,
  defaultConfigForVariant,
  DEFAULT_GAME_CONFIG,
} from '@hidden/game-core'
import { describe, expect, it } from 'vitest'
import {
  createGuestName,
  getBackTarget,
  getOpponentName,
  getResultHeadline,
  getScoreCountLabels,
  getScreenLabel,
  getTurnStatusText,
  isPrototypeMatch,
  quickMatchConfig,
  resolvePlayerName,
  shouldPromptMoveChoice,
  isRevealSnapshotOpen,
  shouldShowOpponentPanel,
} from '../viewModel'
import type { GameState } from '../types'

const makeMatch = (overrides: Partial<GameState> = {}): GameState => ({
  config: {
    ...DEFAULT_GAME_CONFIG,
    isOnline: false,
    hasAI: true,
  },
  phase: 'battle',
  playerGrid: { cells: [] },
  opponentGrid: { cells: [] },
  isMyTurn: true,
  currentRound: 1,
  totalTurns: 0,
  maxTurns: 12,
  selectedSymbol: null,
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
    expect(getScreenLabel('history')).toBe('History')
    expect(getScreenLabel('sync-lost')).toBe('Sync Lost')
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
    expect(getBackTarget('sync-lost', true)).toBe('online-menu')
    expect(getBackTarget('history')).toBe('intro')
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

  const revealing = () =>
    makeMatch({
      playerPowerups: {
        unlocked: { shield: false, reveal: true, extraTurn: false },
        used: { shield: false, reveal: true, extraTurn: false },
        revealActive: true,
        extraTurnArmed: false,
      },
    })

  const seeing = (match = makeMatch()) =>
    makeMatch({ ...match, config: { ...match.config, blindMode: false } })

  /*
   * These were one predicate, and conflating them is what made the snapshot
   * possible to leave open forever: a non-blind match satisfied "show the
   * opponent board" permanently, which as a timed modal meant a countdown that
   * ran out and a card that never left.
   */
  it('opens the snapshot only while a reveal is actually running', () => {
    expect(isRevealSnapshotOpen(null)).toBe(false)
    expect(isRevealSnapshotOpen(makeMatch())).toBe(false)
    expect(isRevealSnapshotOpen(revealing())).toBe(true)
  })

  it('never opens the snapshot in a mode that was never hiding anything', () => {
    expect(isRevealSnapshotOpen(seeing())).toBe(false)
    expect(isRevealSnapshotOpen(seeing(revealing()))).toBe(false)
  })

  it('shows the standing panel only when the mode does not hide the board', () => {
    expect(shouldShowOpponentPanel(null)).toBe(false)
    expect(shouldShowOpponentPanel(makeMatch())).toBe(false)
    expect(shouldShowOpponentPanel(revealing())).toBe(false)
    expect(shouldShowOpponentPanel(seeing())).toBe(true)
  })

  it('prompts the move choice only while the player owes an unloaded move', () => {
    expect(shouldPromptMoveChoice(makeMatch(), 'battle')).toBe(true)

    expect(shouldPromptMoveChoice(null, 'battle')).toBe(false)
    expect(shouldPromptMoveChoice(makeMatch(), 'results')).toBe(false)
    expect(shouldPromptMoveChoice(makeMatch({ isMyTurn: false }), 'battle')).toBe(false)
    expect(shouldPromptMoveChoice(makeMatch({ selectedSymbol: 'paper' }), 'battle')).toBe(false)
    expect(shouldPromptMoveChoice(makeMatch({ shieldSelectionMode: true }), 'battle')).toBe(false)
    expect(shouldPromptMoveChoice(makeMatch({ phase: 'results' }), 'battle')).toBe(false)
  })

  it('names the turn state without naming the opponent', () => {
    expect(getTurnStatusText(makeMatch())).toBe('Your Turn')
    expect(getTurnStatusText(makeMatch({ shieldSelectionMode: true }))).toBe(
      'Choose a tile to shield.',
    )

    /*
     * The waiting line reads at a glance and a long name wrapped it, so the
     * opponent is referred to by role. Their name is on their own board and in
     * the top bar already.
     */
    const waiting = getTurnStatusText(makeMatch({ isMyTurn: false }))
    expect(waiting).toBe('Waiting for opponent')
    expect(waiting).not.toContain('Practice Bot')
  })

  it('assigns sequential score labels only to occupied cells', () => {
    const cells = Array.from({ length: 9 }, (_, index) => ({
      occupied: index === 1 || index === 4 || index === 8,
      symbol: index === 1 || index === 4 || index === 8 ? ('paper' as const) : null,
      immune: false,
      desecrated: false,
    }))

    expect(getScoreCountLabels(cells)).toEqual({ 1: 1, 4: 2, 8: 3 })
  })
})

describe('quickMatchConfig', () => {
  it('sends an admin their full config', () => {
    const config = clampGameConfig({ ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 5 })
    expect(quickMatchConfig(config, true)).toEqual(config)
  })

  it('sends a non-admin only their variant, on default rules', () => {
    const config = clampGameConfig({
      ...DEFAULT_GAME_CONFIG,
      variant: 'prototype',
      turnSeconds: 45,
    })
    const sent = quickMatchConfig(config, false)

    // The variant decides which queue you join, so it travels. The rest would
    // bind a stranger to rules they never saw, so it does not.
    expect(sent.variant).toBe('prototype')
    expect(sent.turnSeconds).toBe(DEFAULT_GAME_CONFIG.turnSeconds)
    expect(sent).toEqual(defaultConfigForVariant('prototype'))
  })

  it('is the plain default for a non-admin on main', () => {
    expect(quickMatchConfig(DEFAULT_GAME_CONFIG, false)).toEqual(DEFAULT_GAME_CONFIG)
  })
})

describe('prototype result presentation', () => {
  const finished = (variant: 'main' | 'prototype', outcome: 'win' | 'loss' | 'tie') =>
    makeMatch({
      config: { ...defaultConfigForVariant(variant), isOnline: false, hasAI: true },
      phase: 'results',
      result: { playerScore: 5, opponentScore: 4, outcome },
    })

  it('declares an outcome for main', () => {
    expect(getResultHeadline(finished('main', 'win'))).toBe('YOU WIN!')
    expect(getResultHeadline(finished('main', 'loss'))).toBe('YOU LOSE!')
    expect(getResultHeadline(finished('main', 'tie'))).toBe("IT'S A TIE!")
  })

  it('declares nothing for the prototype, whatever the scores say', () => {
    expect(getResultHeadline(finished('prototype', 'win'))).toBe('TBD')
    expect(getResultHeadline(finished('prototype', 'loss'))).toBe('TBD')
  })

  it('identifies a prototype match', () => {
    expect(isPrototypeMatch(finished('prototype', 'win'))).toBe(true)
    expect(isPrototypeMatch(finished('main', 'win'))).toBe(false)
    expect(isPrototypeMatch(null)).toBe(false)
  })
})
