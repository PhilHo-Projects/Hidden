import { describe, expect, it } from 'vitest'
import type { MatchConfig } from './types'
import {
  createOnlineMatchConfig,
  restartMatch,
  transitionOnlineMatchEvent,
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
})
