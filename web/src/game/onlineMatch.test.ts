import { describe, expect, it } from 'vitest'
import type { MatchConfig } from './types'
import {
  beginOnlineMatch,
  createOnlineMatchConfig,
  restartMatch,
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

  it('starts from the received rules and the server-assigned turn', () => {
    let started:
      | { config: MatchConfig; isMyTurn: boolean }
      | undefined

    beginOnlineMatch(
      { rounds: 4, turnSeconds: 18, blindMode: true },
      false,
      (config, isMyTurn) => {
        started = { config, isMyTurn }
      },
    )

    expect(started).toEqual({
      config: {
        rounds: 4,
        turnSeconds: 18,
        blindMode: true,
        isOnline: true,
        hasAI: false,
      },
      isMyTurn: false,
    })
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
