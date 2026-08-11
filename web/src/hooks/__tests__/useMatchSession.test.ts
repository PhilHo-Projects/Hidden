/** @vitest-environment jsdom */

import {
  DEFAULT_GAME_CONFIG,
  ENGINE_REVISION,
} from '@hidden/game-core'
import { act, createElement, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiStatus } from '../../components/PregameUi'
import type { ClientEvent } from '../../game/networkClient'
import { MATCH_COUNTDOWN_DURATION_MS } from '../../game/onlineMatch'
import type { Screen } from '../../game/viewModel'
import {
  useMatchSession,
  type MatchNetworkClient,
  type MatchSession,
} from '../useMatchSession'

class MemoryNetworkClient implements MatchNetworkClient {
  clientId: number | null = null
  private listener: ((event: ClientEvent) => void) | undefined

  subscribe(listener: (event: ClientEvent) => void) {
    this.listener = listener
    return () => {
      this.listener = undefined
    }
  }

  async connect() {}
  async sendUserName() { return true }
  async joinRoom() { return true }
  startMatchmaking() {}
  cancelMatchmaking() {}
  sendReady() {}
  sendGameCommand() {}
  createLobbyGame() {}
  joinLobbyGame() {}
  cancelLobbyGame() {}
  subscribeLobby() {}

  close(reason = 'Connection closed by user') {
    this.emit({ type: 'close', reason })
  }

  emit(event: ClientEvent) {
    if (event.type === 'assigned-id') this.clientId = event.clientId
    this.listener?.(event)
  }
}

describe('useMatchSession', () => {
  let container: HTMLDivElement
  let root: Root
  let client: MemoryNetworkClient
  let current: {
    session: MatchSession
    screen: Screen
    status: UiStatus
  }

  function Harness() {
    const [screen, setScreen] = useState<Screen>('intro')
    const [status, setStatus] = useState<UiStatus>({
      tone: 'neutral',
      label: 'GUEST',
      detail: 'Choose how you want to play.',
    })
    const screenRef = useRef<Screen>('intro')
    useEffect(() => {
      screenRef.current = screen
    }, [screen])

    const session = useMatchSession({
      screen,
      screenRef,
      setScreen,
      setStatus,
      createClient: () => client,
      clearDestructionEffects: () => undefined,
      queueDestructionEffect: () => undefined,
      lobby: {
        clearLobbyError: () => undefined,
        beginHosting: () => undefined,
        beginBrowsing: () => undefined,
        clearForMatchFound: () => undefined,
        leaveLobby: () => undefined,
        handleClientEvent: () => false,
      },
    })
    current = { session, screen, status }
    return null
  }

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    client = new MemoryNetworkClient()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('starts an offline bot match after the visible countdown', async () => {
    let start: Promise<void>
    await act(async () => {
      start = current.session.startOffline(DEFAULT_GAME_CONFIG)
      await vi.advanceTimersByTimeAsync(MATCH_COUNTDOWN_DURATION_MS)
      await start
    })

    expect(current.screen).toBe('battle')
    expect(current.session.match?.phase).toBe('battle')
    expect(current.session.match?.config).toMatchObject({
      isOnline: false,
      hasAI: true,
    })
    expect(current.status).toEqual({
      tone: 'success',
      label: 'OFFLINE',
      detail: 'Practice bot ready.',
    })
  })

  it('reports an unexpected close as disconnected', async () => {
    await act(async () => current.session.startOnline('Guest#0042'))
    await act(async () => client.emit({ type: 'close', reason: 'network gone' }))

    expect(current.screen).toBe('disconnected')
    expect(current.status).toEqual({
      tone: 'error',
      label: 'CONNECTION LOST',
      detail: 'network gone',
    })
  })

  it('ignores the close event triggered by an intentional reset', async () => {
    await act(async () => current.session.startOnline('Guest#0042'))

    await act(async () => current.session.resetForHome())

    expect(current.screen).toBe('matchmaking')
    expect(current.status.label).toBe('SEARCHING')
  })

  it('fails closed when a match starts before client identity is assigned', async () => {
    await act(async () => current.session.startOnline('Guest#0042'))
    await act(async () => client.emit({
      type: 'match-found',
      roomId: 'room-1',
      config: DEFAULT_GAME_CONFIG,
    }))
    expect(current.screen).toBe('ready')

    await act(async () => client.emit({
      type: 'game-start',
      firstPlayerId: 7,
      descriptor: {
        matchId: 'match-1',
        engine: { id: 'classic', revision: ENGINE_REVISION },
        config: DEFAULT_GAME_CONFIG,
        seed: 42,
        firstSeat: 0,
        revision: 0,
        turnTimeRemainingMs: 10_000,
      },
    }))

    expect(current.screen).toBe('sync-lost')
    expect(current.status).toEqual({
      tone: 'error',
      label: 'SYNC LOST',
      detail: 'The match started before client identity was assigned.',
    })
  })
})
