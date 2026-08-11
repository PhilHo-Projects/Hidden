/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthClient, AuthUser } from '../../auth/authClient'
import type { UiStatus } from '../../components/PregameUi'
import { useAccountSession, type AccountSession } from '../useAccountSession'

const PLAYER: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'HiddenPlayer',
  role: 'player',
}

function clientDouble(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: async () => null,
    register: async (username) => ({ ...PLAYER, username }),
    login: async (username) => ({ ...PLAYER, username }),
    logout: async () => undefined,
    ...overrides,
  }
}

describe('useAccountSession', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let current: AccountSession
  let statuses: UiStatus[]

  async function render(client: AuthClient) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    statuses = []
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    function Harness() {
      current = useAccountSession({
        client,
        guestUsername: 'Guest#0042',
        onStatusChange: (status) => statuses.push(status),
      })
      return null
    }

    await act(async () => root!.render(createElement(Harness)))
  }

  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  it('hydrates a saved account and reports its identity', async () => {
    await render(clientDouble({ getSession: async () => PLAYER }))

    expect(current.authHydrated).toBe(true)
    expect(current.authUser).toEqual(PLAYER)
    expect(statuses).toEqual([{
      tone: 'success',
      label: 'ACCOUNT',
      detail: 'Signed in as HiddenPlayer.',
    }])
  })

  it('keeps guest play available when session hydration fails', async () => {
    await render(clientDouble({
      getSession: async () => {
        throw new Error('service unavailable')
      },
    }))

    expect(current.authHydrated).toBe(true)
    expect(current.authUser).toBeNull()
    expect(current.authError).toBeNull()
    expect(statuses).toEqual([])
  })

  it('authenticates with the selected mode and exposes account failures', async () => {
    await render(clientDouble({
      login: async () => {
        throw new Error('network down')
      },
    }))
    await act(async () => current.prepareAccount('login'))

    let rejection: unknown
    await act(async () => {
      try {
        await current.submitAccount('HiddenPlayer', 'secret')
      } catch (cause) {
        rejection = cause
      }
    })

    expect(rejection).toEqual(new Error('network down'))
    expect(current.authUser).toBeNull()
    expect(current.authBusy).toBe(false)
    expect(current.authError).toBe('Accounts are temporarily unavailable.')
    expect(statuses.at(-1)).toEqual({
      tone: 'error',
      label: 'ACCOUNT ERROR',
      detail: 'Accounts are temporarily unavailable.',
    })
  })

  it('retains the account when logout fails and clears it when invalidated', async () => {
    await render(clientDouble({
      getSession: async () => PLAYER,
      logout: async () => {
        throw new Error('network down')
      },
    }))

    let loggedOut = true
    await act(async () => {
      loggedOut = await current.logoutAccount()
    })
    expect(loggedOut).toBe(false)
    expect(current.authUser).toEqual(PLAYER)
    expect(current.authError).toBe('Accounts are temporarily unavailable.')

    await act(async () => {
      current.invalidateSession('Your session expired. Sign in again.')
    })
    expect(current.authUser).toBeNull()
    expect(current.authMode).toBe('login')
    expect(current.authError).toBe('Your session expired. Sign in again.')
  })
})
