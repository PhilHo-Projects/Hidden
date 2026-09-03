import { describe, expect, it, vi } from 'vitest'
import {
  AuthApiError,
  createAuthClient,
  type AuthAccount,
} from './authClient'

const ACCOUNT_RESPONSE = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Player_One',
    email: 'private@example.test',
    emailVerified: true,
    username: 'player_one',
    displayUsername: 'Player_One',
    role: 'player',
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
  },
  session: {
    id: '00000000-0000-4000-8000-000000000011',
    token: 'current-secret-token',
    userId: '00000000-0000-4000-8000-000000000001',
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
    expiresAt: '2030-02-01T00:00:00.000Z',
  },
}

const EXPECTED_ACCOUNT: AuthAccount = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'Player_One',
    role: 'player',
  },
  email: 'private@example.test',
  emailVerified: true,
  currentSessionId: '00000000-0000-4000-8000-000000000011',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestDetails(call: unknown[]) {
  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined]
  return {
    url: String(input),
    method: init?.method,
    headers: new Headers(init?.headers),
    body: init?.body
      ? JSON.parse(String(init.body)) as Record<string, unknown>
      : undefined,
  }
}

describe('Better Auth client adapter', () => {
  it('restores a private account while keeping public identity email-free', async () => {
    const fetcher = vi.fn(async () => json(ACCOUNT_RESPONSE))
    const account = await createAuthClient(fetcher).getSession()

    expect(account).toEqual(EXPECTED_ACCOUNT)
    expect(account?.user).not.toHaveProperty('email')
    expect(requestDetails(fetcher.mock.calls[0]!).url).toBe(
      'http://localhost/api/auth/get-session',
    )
  })

  it('registers with the canonical/display username pair, email, and one-use captcha', async () => {
    const fetcher = vi.fn(async () =>
      json({ token: null, user: ACCOUNT_RESPONSE.user }),
    )
    const client = createAuthClient(fetcher)

    await expect(client.register({
      username: 'Player_One',
      email: 'private@example.test',
      password: '12345678',
      captchaToken: 'turnstile-token',
    })).resolves.toEqual({ email: 'private@example.test' })

    const request = requestDetails(fetcher.mock.calls[0]!)
    expect(request.url).toBe('http://localhost/api/auth/sign-up/email')
    expect(request.method).toBe('POST')
    expect(request.headers.get('x-captcha-response')).toBe('turnstile-token')
    expect(request.body).toMatchObject({
      name: 'Player_One',
      username: 'player_one',
      displayUsername: 'Player_One',
      email: 'private@example.test',
      password: '12345678',
      callbackURL: '/?auth=verified',
    })
  })

  it('selects email or username sign-in and resolves the same public account', async () => {
    const emailFetch = vi.fn()
      .mockResolvedValueOnce(json({ token: 'session', user: ACCOUNT_RESPONSE.user }))
      .mockResolvedValueOnce(json(ACCOUNT_RESPONSE))
    const usernameFetch = vi.fn()
      .mockResolvedValueOnce(json({ token: 'session', user: ACCOUNT_RESPONSE.user }))
      .mockResolvedValueOnce(json(ACCOUNT_RESPONSE))

    await expect(
      createAuthClient(emailFetch).login('private@example.test', '12345678'),
    ).resolves.toEqual(EXPECTED_ACCOUNT)
    await expect(
      createAuthClient(usernameFetch).login('Player_One', '12345678'),
    ).resolves.toEqual(EXPECTED_ACCOUNT)

    expect(requestDetails(emailFetch.mock.calls[0]!).url).toContain('/sign-in/email')
    expect(requestDetails(usernameFetch.mock.calls[0]!).url).toContain('/sign-in/username')
    expect(requestDetails(usernameFetch.mock.calls[0]!).body).toMatchObject({
      username: 'Player_One',
      password: '12345678',
    })
  })

  it('protects recovery and verification resend with Turnstile and generic recovery copy', async () => {
    const fetcher = vi.fn(async () => json({ status: true }))
    const client = createAuthClient(fetcher)

    await expect(
      client.requestPasswordReset('private@example.test', 'captcha-a'),
    ).resolves.toBeUndefined()
    await expect(
      client.resendVerification('private@example.test', 'captcha-b'),
    ).resolves.toBeUndefined()

    const recovery = requestDetails(fetcher.mock.calls[0]!)
    expect(recovery.url).toContain('/request-password-reset')
    expect(recovery.headers.get('x-captcha-response')).toBe('captcha-a')
    expect(recovery.body).toEqual({
      email: 'private@example.test',
      redirectTo: '/?auth=reset-password',
    })
    const resend = requestDetails(fetcher.mock.calls[1]!)
    expect(resend.url).toContain('/send-verification-email')
    expect(resend.headers.get('x-captcha-response')).toBe('captcha-b')
  })

  it('resets and changes passwords, changes email, and manages device sessions', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/list-sessions')) {
        return json([
          ACCOUNT_RESPONSE.session,
          {
            ...ACCOUNT_RESPONSE.session,
            id: '00000000-0000-4000-8000-000000000022',
            token: 'other-secret-token',
            userAgent: 'Firefox',
            ipAddress: '203.0.113.4',
          },
        ])
      }
      if (url.endsWith('/change-password')) {
        return json({ token: null, user: ACCOUNT_RESPONSE.user })
      }
      return json({ status: true })
    })
    const client = createAuthClient(fetcher)

    await client.resetPassword('reset-token', 'new-password')
    await client.changePassword('old-password', 'new-password')
    await client.changeEmail('new@example.test')
    await expect(
      client.listSessions(EXPECTED_ACCOUNT.currentSessionId),
    ).resolves.toEqual([
      expect.objectContaining({
        id: EXPECTED_ACCOUNT.currentSessionId,
        current: true,
        token: 'current-secret-token',
      }),
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000022',
        current: false,
        userAgent: 'Firefox',
      }),
    ])
    await client.revokeSession('other-secret-token')
    await client.signOutOtherSessions()

    expect(requestDetails(fetcher.mock.calls[0]!).body).toEqual({
      token: 'reset-token',
      newPassword: 'new-password',
    })
    expect(requestDetails(fetcher.mock.calls[1]!).body).toMatchObject({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    })
    expect(requestDetails(fetcher.mock.calls[2]!).body).toEqual({
      newEmail: 'new@example.test',
      callbackURL: '/?auth=verified',
    })
    expect(requestDetails(fetcher.mock.calls[4]!).body).toEqual({
      token: 'other-secret-token',
    })
    expect(requestDetails(fetcher.mock.calls[5]!).url).toContain(
      '/revoke-other-sessions',
    )
  })

  it('maps Better Auth failures into stable Hidden copy without leaking provider messages', async () => {
    const fetcher = vi.fn(async () => json({
      code: 'INVALID_USERNAME_OR_PASSWORD',
      message: 'raw provider detail',
    }, 401))

    await expect(
      createAuthClient(fetcher).login('Player_One', 'wrong-password'),
    ).rejects.toEqual(expect.objectContaining<Partial<AuthApiError>>({
      code: 'invalid_credentials',
      message: 'Username/email or password is incorrect.',
    }))
  })

  it('rejects malformed successful session payloads instead of exposing arbitrary fields', async () => {
    const fetcher = vi.fn(async () => json({
      ...ACCOUNT_RESPONSE,
      user: { ...ACCOUNT_RESPONSE.user, role: 'owner', secret: 'leak' },
    }))

    await expect(createAuthClient(fetcher).getSession()).rejects.toEqual(
      expect.objectContaining<Partial<AuthApiError>>({
        code: 'account_service_unavailable',
      }),
    )
  })
})
