import { describe, expect, it } from 'vitest'
import type { MatchConfig } from './types'
import type { Screen } from './viewModel'
import {
  createOnlineMatchConfig,
  isOnlineTerminalScreen,
  MATCH_COUNTDOWN_DURATION_MS,
  MATCH_COUNTDOWN_STEPS,
  markOnlineTerminalScreen,
  restartMatch,
  shouldResolveTimeoutLocally,
  transitionOnlineMatchEvent,
  tryMarkOnlineTerminalScreen,
} from './onlineMatch'

const ONLINE_CONFIG: MatchConfig = {
  rounds: 3,
  turnSeconds: 25,
  blindMode: false,
  isOnline: true,
  hasAI: false,
}

describe('online match flow', () => {
  it('builds online config exclusively from the server-resolved rules', () => {
    expect(
      createOnlineMatchConfig({
        rounds: 3,
        turnSeconds: 25,
        blindMode: false,
      }),
    ).toEqual(ONLINE_CONFIG)
  })

  it('carries server rules from match-found into game-start instead of local settings', () => {
    const persistedLocalConfig: MatchConfig = {
      rounds: 20,
      turnSeconds: 60,
      blindMode: false,
      isOnline: false,
      hasAI: true,
    }
    const matchFound = transitionOnlineMatchEvent(
      { rules: null },
      {
        type: 'match-found',
        rules: { rounds: 4, turnSeconds: 18, blindMode: true },
      },
    )
    if (matchFound.type !== 'match-found') {
      throw new Error('Expected a match-found transition.')
    }

    const gameStart = transitionOnlineMatchEvent(matchFound.state, {
      type: 'game-start',
      isMyTurn: false,
    })
    if (gameStart.type !== 'game-start') {
      throw new Error('Expected a game-start transition.')
    }

    expect(gameStart).toEqual({
      type: 'game-start',
      state: {
        rules: { rounds: 4, turnSeconds: 18, blindMode: true },
      },
      config: {
        rounds: 4,
        turnSeconds: 18,
        blindMode: true,
        isOnline: true,
        hasAI: false,
      },
      isMyTurn: false,
    })
    expect(gameStart.config).not.toEqual(persistedLocalConfig)
  })

  it('sends ready and returns to ready instead of starting online locally', () => {
    const readyValues: boolean[] = []
    let screen = 'results'
    let localConfig: MatchConfig | undefined

    restartMatch({
      config: ONLINE_CONFIG,
      sendReady: (ready) => readyValues.push(ready),
      showReady: () => {
        screen = 'ready'
      },
      beginLocalMatch: (config) => {
        localConfig = config
      },
    })

    expect(readyValues).toEqual([true])
    expect(screen).toBe('ready')
    expect(localConfig).toBeUndefined()
  })

  it('keeps offline replay immediate with the completed match config', () => {
    const offlineConfig: MatchConfig = {
      ...ONLINE_CONFIG,
      isOnline: false,
      hasAI: true,
    }
    const readyValues: boolean[] = []
    let screen = 'results'
    let localConfig: MatchConfig | undefined

    restartMatch({
      config: offlineConfig,
      sendReady: (ready) => readyValues.push(ready),
      showReady: () => {
        screen = 'ready'
      },
      beginLocalMatch: (config) => {
        localConfig = config
      },
    })

    expect(readyValues).toEqual([])
    expect(screen).toBe('results')
    expect(localConfig).toEqual(offlineConfig)
  })

  it('keeps online expiry display-only while offline expiry resolves immediately', () => {
    expect(shouldResolveTimeoutLocally(ONLINE_CONFIG)).toBe(false)
    expect(shouldResolveTimeoutLocally({ ...ONLINE_CONFIG, isOnline: false })).toBe(true)
  })

  it('keeps the visible countdown below the server launch-grace contract', () => {
    expect(MATCH_COUNTDOWN_STEPS).toEqual([
      { label: '3', durationMs: 700 },
      { label: '2', durationMs: 700 },
      { label: '1', durationMs: 700 },
      { label: 'GO!', durationMs: 520 },
    ])
    expect(MATCH_COUNTDOWN_DURATION_MS).toBe(2_620)
    expect(MATCH_COUNTDOWN_DURATION_MS).toBeLessThan(3_000)
  })

  it('makes opponent disconnect terminal before a later authoritative update can run', () => {
    const screenRef: { current: Screen } = { current: 'battle' }

    markOnlineTerminalScreen(screenRef, 'disconnected')

    expect(screenRef.current).toBe('disconnected')
    expect(isOnlineTerminalScreen(screenRef.current)).toBe(true)
  })

  it('also treats sync-lost as terminal for later authoritative updates', () => {
    const screenRef: { current: Screen } = { current: 'battle' }

    markOnlineTerminalScreen(screenRef, 'sync-lost')

    expect(screenRef.current).toBe('sync-lost')
    expect(isOnlineTerminalScreen(screenRef.current)).toBe(true)
    expect(isOnlineTerminalScreen('battle')).toBe(false)
  })

  it('keeps sync-lost terminal when opponent-disconnected arrives afterward', () => {
    const screenRef: { current: Screen } = { current: 'battle' }

    expect(tryMarkOnlineTerminalScreen(screenRef, 'sync-lost')).toBe(true)
    expect(tryMarkOnlineTerminalScreen(screenRef, 'disconnected')).toBe(false)
    expect(screenRef.current).toBe('sync-lost')
  })
})
