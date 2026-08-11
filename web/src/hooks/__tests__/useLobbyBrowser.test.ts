/** @vitest-environment jsdom */

import { DEFAULT_GAME_CONFIG } from '@hidden/game-core'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLobbyBrowser, type LobbyBrowser } from '../useLobbyBrowser'

describe('useLobbyBrowser', () => {
  let container: HTMLDivElement
  let root: Root
  let current: LobbyBrowser

  function Harness() {
    current = useLobbyBrowser()
    return null
  }

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('handles only lobby events and maps their payloads into browser state', async () => {
    expect(current.handleClientEvent({ type: 'assigned-id', clientId: 7 })).toBe(false)

    await act(async () => {
      expect(current.handleClientEvent({
        type: 'lobby-created',
        code: 'ABC12',
        config: DEFAULT_GAME_CONFIG,
        isPrivate: true,
      })).toBe(true)
    })
    expect(current.hostedCode).toBe('ABC12')

    const game = {
      code: 'ROOM1',
      hostName: 'HostPlayer',
      config: DEFAULT_GAME_CONFIG,
    }
    await act(async () => {
      expect(current.handleClientEvent({ type: 'lobby-list', games: [game] })).toBe(true)
    })
    expect(current.lobbyGames).toEqual([game])

    await act(async () => {
      expect(current.handleClientEvent({ type: 'lobby-error', reason: 'own-game' })).toBe(true)
    })
    expect(current.lobbyError).toBe('You cannot join your own game.')
  })

  it('prepares create and browse screens without leaking prior errors', async () => {
    await act(async () => {
      current.beginHosting()
      current.handleClientEvent({ type: 'lobby-error', reason: 'already-hosting' })
    })
    expect(current.hostingStarted).toBe(true)
    expect(current.lobbyError).toBe('You are already hosting a game.')

    await act(async () => current.prepareCreate())
    expect(current.hostedCode).toBeNull()
    expect(current.hostingStarted).toBe(false)
    expect(current.lobbyError).toBeNull()

    await act(async () => current.beginBrowsing())
    expect(current.lobbyGames).toEqual([])
    expect(current.lobbyError).toBeNull()
  })

  it('normalizes join codes and clears transient state when leaving', async () => {
    await act(async () => {
      current.setJoinCodeInput('ab12c')
      current.togglePrivateGame()
      current.beginHosting()
      current.handleClientEvent({
        type: 'lobby-created',
        code: 'ABC12',
        config: DEFAULT_GAME_CONFIG,
        isPrivate: true,
      })
      current.handleClientEvent({ type: 'lobby-error', reason: 'not-found' })
    })

    expect(current.joinCodeInput).toBe('AB12C')
    expect(current.isPrivateGame).toBe(true)

    await act(async () => current.leaveLobby())
    expect(current.hostedCode).toBeNull()
    expect(current.hostingStarted).toBe(false)
    expect(current.lobbyGames).toEqual([])
    expect(current.lobbyError).toBeNull()
    expect(current.joinCodeInput).toBe('AB12C')
    expect(current.isPrivateGame).toBe(true)
  })
})
