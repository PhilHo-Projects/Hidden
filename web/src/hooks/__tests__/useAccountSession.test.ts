/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AuthAccount,
  AuthClient,
} from '../../auth/authClient'
import { AuthApiError } from '../../auth/authClient'
import type { AuthRedirectIntent } from '../../auth/authRedirect'
import type { UiStatus } from '../../components/PregameUi'
import { useAccountSession, type AccountSession } from '../useAccountSession'

const ACCOUNT: AuthAccount = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'HiddenPlayer',
    role: 'player',
  },
  email: 'private@example.test',
  emailVerified: true,
  currentSessionId: '00000000-0000-4000-8000-000000000011',
}

function clientDouble(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: async () => null,
    register: async ({ email }) => ({ email }),
    login: async () => ACCOUNT,
    requestPasswordReset: async () => undefined,
    resendVerification: async () => undefined,
    resetPassword: async () => undefined,
    changePassword: async () => undefined,
    changeEmail: async () => undefined,
    listSessions: async () => [],
    revokeSession: async () => undefined,
    signOutOtherSessions: async () => undefined,
    logout: async () => undefined,
    ...overrides,
  }
}

describe('useAccountSession', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let current: AccountSession
  let statuses: UiStatus[]

  async function render(
    client: AuthClient,
    initialIntent?: AuthRedirectIntent | null,
  ) {
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
        initialIntent,
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

  it('hydrates private account state while exposing only public gameplay identity', async () => {
    await render(clientDouble({ getSession: async () => ACCOUNT }))

    expect(current.authHydrated).toBe(true)
    expect(current.authUser).toEqual(ACCOUNT.user)
    expect(current.authUser).not.toHaveProperty('email')
    expect(current.accountEmail).toBe('private@example.test')
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

  it('moves registration into verification without creating a session and resets captcha', async () => {
    const register = vi.fn(async ({ email }) => ({ email }))
    await render(clientDouble({ register }))

    await act(async () => current.prepareAccount('register'))
    await act(async () => current.registerAccount({
      username: 'HiddenPlayer',
      email: 'private@example.test',
      password: '12345678',
      captchaToken: 'captcha',
    }))

    expect(register).toHaveBeenCalledOnce()
    expect(current.authUser).toBeNull()
    expect(current.authMode).toBe('verify')
    expect(current.verificationEmail).toBe('private@example.test')
    expect(current.captchaResetKey).toBe(1)
    expect(current.authNotice).toContain('Check your email')
  })

  it('consumes a reset intent, reports generic recovery success, and returns to login after reset', async () => {
    const requestPasswordReset = vi.fn()
    const resetPassword = vi.fn()
    await render(clientDouble({ requestPasswordReset, resetPassword }), {
      view: 'reset',
      token: 'in-memory-token',
    })

    expect(current.authMode).toBe('reset')
    await act(async () => current.requestRecovery('private@example.test', 'captcha'))
    expect(current.authNotice).toBe(
      'If that email belongs to an account, a reset link is on its way.',
    )
    expect(current.captchaResetKey).toBe(1)

    await act(async () => current.resetAccountPassword('new-password'))
    expect(resetPassword).toHaveBeenCalledWith('in-memory-token', 'new-password')
    expect(current.authMode).toBe('login')
    expect(current.authNotice).toContain('Password changed')
  })

  it('loads devices, revokes another session, and supports private email/password settings', async () => {
    const otherSession = {
      id: '00000000-0000-4000-8000-000000000022',
      token: 'other-token',
      current: false,
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
      updatedAt: new Date('2030-01-02T00:00:00.000Z'),
      expiresAt: new Date('2030-02-01T00:00:00.000Z'),
      userAgent: 'Firefox',
    }
    const listSessions = vi.fn(async () => [otherSession])
    const revokeSession = vi.fn()
    const changeEmail = vi.fn()
    const changePassword = vi.fn()
    await render(clientDouble({
      getSession: async () => ACCOUNT,
      listSessions,
      revokeSession,
      changeEmail,
      changePassword,
    }))

    await act(async () => current.prepareAccount('settings'))
    expect(listSessions).toHaveBeenCalledWith(ACCOUNT.currentSessionId)
    expect(current.deviceSessions).toEqual([otherSession])
    await act(async () => current.revokeDevice('other-token'))
    expect(revokeSession).toHaveBeenCalledWith('other-token')
    await act(async () => current.requestEmailChange('new@example.test'))
    await act(async () => current.changeAccountPassword('old-password', 'new-password'))
    expect(changeEmail).toHaveBeenCalledWith('new@example.test')
    expect(changePassword).toHaveBeenCalledWith('old-password', 'new-password')
  })

  it('drops private account state when a settings request reports an expired session', async () => {
    await render(clientDouble({
      getSession: async () => ACCOUNT,
      listSessions: async () => {
        throw new AuthApiError('session_expired', 'Your session expired. Sign in again.')
      },
    }))

    await act(async () => current.prepareAccount('settings'))
    expect(current.authUser).toBeNull()
    expect(current.accountEmail).toBeNull()
    expect(current.authMode).toBe('login')
    expect(current.authError).toBe('Your session expired. Sign in again.')
  })
})
