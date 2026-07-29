import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHiddenServer, type HiddenServer } from '../app'
import type { AuthUser } from './repository'
import { AuthServiceError, type AuthSession } from './service'

const ORIGIN = 'http://localhost:5173'
const USER: AuthUser = {
  id: '9133d041-fdae-48fc-969d-c9e868c94b79',
  username: 'Player_One',
}

class HttpTestAuthService {
  private nextToken = 1
  private readonly sessions = new Map<string, AuthUser>()

  async register(input: unknown): Promise<AuthSession> {
    const body = input as Record<string, unknown>
    if (body.username === 'Taken_Player') {
      throw new AuthServiceError(
        'username_taken',
        'That username is already taken.',
        'username',
      )
    }
    return this.issue()
  }

  async login(input: unknown): Promise<AuthSession> {
    const body = input as Record<string, unknown>
    if (body.password === 'wrong password') {
      throw new AuthServiceError(
        'invalid_credentials',
        'Username or password is incorrect.',
      )
    }
    return this.issue()
  }

  async getSession(rawToken: string | undefined) {
    return rawToken ? this.sessions.get(rawToken) : undefined
  }

  async logout(rawToken: string | undefined) {
    if (rawToken) {
      this.sessions.delete(rawToken)
    }
  }

  async cleanupExpiredSessions() {
    return 0
  }

  private issue(): AuthSession {
    const rawToken = String(this.nextToken++).padStart(43, 'a')
    this.sessions.set(rawToken, USER)
    return {
      user: USER,
      rawToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
    }
  }
}

let server: HiddenServer | undefined
let staticRoot: string | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  if (staticRoot) {
    await rm(staticRoot, { recursive: true, force: true })
    staticRoot = undefined
  }
})

async function startServer(
  authService?: HttpTestAuthService,
  overrides: Partial<Parameters<typeof createHiddenServer>[0]> = {},
) {
  staticRoot = await mkdtemp(path.join(tmpdir(), 'hidden-auth-static-'))
  await writeFile(path.join(staticRoot, 'index.html'), '<title>Hidden</title>')
  server = createHiddenServer({
    allowedOrigins: [ORIGIN],
    ...(authService ? { authService } : {}),
    heartbeatIntervalMs: 0,
    logLevel: 'silent',
    port: 0,
    sessionCookieSecure: false,
    staticRoot,
    ...overrides,
  })
  return server.start()
}

function authPost(body: unknown, cookie?: string) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  }
}

function sessionCookie(response: Response) {
  const header = response.headers.get('set-cookie')
  expect(header).toBeTruthy()
  return header!.split(';')[0]!
}

describe.sequential('Hidden auth HTTP API', () => {
  it('registers, restores, and logs out the current browser session', async () => {
    const { port } = await startServer(new HttpTestAuthService())
    const register = await fetch(
      `http://127.0.0.1:${port}/api/auth/register`,
      authPost({
        username: 'Player_One',
        password: 'correct horse battery staple',
      }),
    )
    const cookie = sessionCookie(register)

    expect(register.status).toBe(201)
    expect(register.headers.get('cache-control')).toBe('no-store')
    expect(register.headers.get('set-cookie')).toContain('HttpOnly')
    expect(register.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(await register.json()).toEqual({ user: USER })

    const session = await fetch(
      `http://127.0.0.1:${port}/api/auth/session`,
      { headers: { Cookie: cookie } },
    )
    expect(await session.json()).toEqual({ user: USER })

    const logout = await fetch(
      `http://127.0.0.1:${port}/api/auth/logout`,
      authPost({}, cookie),
    )
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')

    const afterLogout = await fetch(
      `http://127.0.0.1:${port}/api/auth/session`,
      { headers: { Cookie: cookie } },
    )
    expect(await afterLogout.json()).toEqual({ user: null })

    const malformed = await fetch(
      `http://127.0.0.1:${port}/api/auth/session`,
      { headers: { Cookie: 'hidden_session=too-short' } },
    )
    expect(malformed.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await malformed.json()).toEqual({ user: null })
  })

  it('maps stable auth failures without exposing credential details', async () => {
    const { port } = await startServer(new HttpTestAuthService())
    const duplicate = await fetch(
      `http://127.0.0.1:${port}/api/auth/register`,
      authPost({
        username: 'Taken_Player',
        password: 'correct horse battery staple',
      }),
    )
    const invalidLogin = await fetch(
      `http://127.0.0.1:${port}/api/auth/login`,
      authPost({
        username: 'Player_One',
        password: 'wrong password',
      }),
    )

    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({
      error: {
        code: 'username_taken',
        message: 'That username is already taken.',
        field: 'username',
      },
    })
    expect(invalidLogin.status).toBe(401)
    expect(await invalidLogin.json()).toEqual({
      error: {
        code: 'invalid_credentials',
        message: 'Username or password is incorrect.',
      },
    })
  })

  it('rejects unsafe origins, non-JSON input, and oversized bodies', async () => {
    const { port } = await startServer(new HttpTestAuthService())
    const badOrigin = await fetch(
      `http://127.0.0.1:${port}/api/auth/login`,
      {
        ...authPost({
          username: 'Player_One',
          password: 'correct horse battery staple',
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
      },
    )
    const nonJson = await fetch(
      `http://127.0.0.1:${port}/api/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Origin: ORIGIN },
        body: 'not json',
      },
    )
    const oversized = await fetch(
      `http://127.0.0.1:${port}/api/auth/login`,
      authPost({
        username: 'Player_One',
        password: 'x'.repeat(5_000),
      }),
    )
    const unsupportedCharset = await fetch(
      `http://127.0.0.1:${port}/api/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=madeup',
          Origin: ORIGIN,
        },
        body: '{}',
      },
    )

    expect(badOrigin.status).toBe(403)
    expect(nonJson.status).toBe(415)
    expect(oversized.status).toBe(413)
    expect(unsupportedCharset.status).toBe(415)
    for (const response of [
      badOrigin,
      nonJson,
      oversized,
      unsupportedCharset,
    ]) {
      expect(response.headers.get('content-type')).toContain(
        'application/json',
      )
      expect((await response.json()).error.code).toBe('invalid_input')
    }
  })

  it('throttles registration and returns Retry-After', async () => {
    const { port } = await startServer(new HttpTestAuthService())
    let response: Response | undefined
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await fetch(
        `http://127.0.0.1:${port}/api/auth/register`,
        authPost({
          username: `Player_${attempt}`,
          password: 'correct horse battery staple',
        }),
      )
    }

    expect(response?.status).toBe(429)
    expect(Number(response?.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await response?.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many account attempts. Try again later.',
      },
    })
  })

  it('uses the trusted reverse-proxy address for per-IP limits', async () => {
    const { port } = await startServer(new HttpTestAuthService(), {
      trustProxy: 1,
    })
    let response: Response | undefined
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const request = authPost({
        username: `Player_${attempt}`,
        password: 'correct horse battery staple',
      })
      response = await fetch(
        `http://127.0.0.1:${port}/api/auth/register`,
        {
          ...request,
          headers: {
            ...request.headers,
            'X-Forwarded-For': '203.0.113.10',
          },
        },
      )
    }
    expect(response?.status).toBe(429)

    const otherIpRequest = authPost({
      username: 'Other_Player',
      password: 'correct horse battery staple',
    })
    const otherIp = await fetch(
      `http://127.0.0.1:${port}/api/auth/register`,
      {
        ...otherIpRequest,
        headers: {
          ...otherIpRequest.headers,
          'X-Forwarded-For': '203.0.113.11',
        },
      },
    )
    expect(otherIp.status).toBe(201)
  })

  it('throttles login per IP and username', async () => {
    const { port } = await startServer(new HttpTestAuthService())
    let response: Response | undefined
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await fetch(
        `http://127.0.0.1:${port}/api/auth/login`,
        authPost({
          username: 'Player_One',
          password: 'wrong password',
        }),
      )
    }

    expect(response?.status).toBe(429)
    expect(Number(response?.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('throttles total login attempts from one IP across usernames', async () => {
    const { port } = await startServer(new HttpTestAuthService())
    let response: Response | undefined
    for (let attempt = 0; attempt < 31; attempt += 1) {
      response = await fetch(
        `http://127.0.0.1:${port}/api/auth/login`,
        authPost({
          username: `Player_${attempt}`,
          password: 'correct horse battery staple',
        }),
      )
    }

    expect(response?.status).toBe(429)
    expect(Number(response?.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('reports explicit guest-only mode when accounts are disabled', async () => {
    const { port } = await startServer()
    const session = await fetch(
      `http://127.0.0.1:${port}/api/auth/session`,
    )
    const register = await fetch(
      `http://127.0.0.1:${port}/api/auth/register`,
      authPost({
        username: 'Player_One',
        password: 'correct horse battery staple',
      }),
    )

    expect(session.status).toBe(503)
    expect(await session.json()).toEqual({
      error: {
        code: 'account_service_unavailable',
        message: 'Accounts are temporarily unavailable.',
      },
    })
    expect(register.status).toBe(503)
    expect(await register.json()).toEqual({
      error: {
        code: 'account_service_unavailable',
        message: 'Accounts are temporarily unavailable.',
      },
    })
  })

  it('logs account outcomes without raw usernames, passwords, or tokens', async () => {
    staticRoot = await mkdtemp(path.join(tmpdir(), 'hidden-auth-static-'))
    await writeFile(path.join(staticRoot, 'index.html'), '<title>Hidden</title>')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      server = createHiddenServer({
        allowedOrigins: [ORIGIN],
        authService: new HttpTestAuthService(),
        heartbeatIntervalMs: 0,
        logLevel: 'info',
        port: 0,
        sessionCookieSecure: false,
        staticRoot,
      })
      const { port } = await server.start()
      await fetch(
        `http://127.0.0.1:${port}/api/auth/register`,
        authPost({
          username: 'Secret_Player',
          password: 'never log this password',
        }),
      )

      const output = log.mock.calls.flat().join('\n')
      expect(output).toContain('"event":"auth.registered"')
      expect(output).not.toContain('Secret_Player')
      expect(output).not.toContain('never log this password')
      expect(output).not.toContain('aaaaaaaaaa')
    } finally {
      log.mockRestore()
    }
  })
})
