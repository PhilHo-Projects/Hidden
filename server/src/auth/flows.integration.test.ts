import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { runMigrations } from '../migrations.js'
import type { EnabledAuthConfig } from './authConfig.js'
import { createHiddenAuth } from './betterAuth.js'
import type {
  TransactionalEmail,
  TransactionalEmailMessage,
} from './email.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip
const baseURL = 'http://127.0.0.1:8080'

type ExternalMode = 'available' | 'compromised' | 'unavailable'

function cookieFrom(response: Response) {
  const cookie = response.headers.getSetCookie()[0]?.split(';', 1)[0]
  if (!cookie) throw new Error('Expected an auth session cookie.')
  return cookie
}

describeDatabase('Better Auth account flows', () => {
  const schemaName = `hidden_auth_flows_${randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
  })
  const delivered = {
    verification: [] as TransactionalEmailMessage[],
    reset: [] as TransactionalEmailMessage[],
    emailChange: [] as TransactionalEmailMessage[],
  }
  const emails: TransactionalEmail = {
    async sendVerification(message) {
      delivered.verification.push(message)
    },
    async sendPasswordReset(message) {
      delivered.reset.push(message)
    },
    async sendEmailChange(message) {
      delivered.emailChange.push(message)
    },
  }
  const config: EnabledAuthConfig = {
    enabled: true,
    production: false,
    databaseUrl: databaseUrl!,
    baseURL,
    secret: '0123456789abcdef0123456789abcdef',
    resendApiKey: 'unused',
    emailFrom: 'Hidden <no-reply@example.test>',
    turnstileSecretKey: 'turnstile-test-only',
    allowedOrigins: [baseURL],
    trustProxyHops: false,
  }
  const auth = createHiddenAuth({
    pool,
    config,
    emails,
    overrides: { turnstileVerifyURL: 'https://turnstile.test/siteverify' },
  })
  let externalMode: ExternalMode = 'available'
  let compromisedPassword = ''

  function externalFetch(input: string | URL | Request) {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    )
    if (url.hostname === 'turnstile.test') {
      return Promise.resolve(Response.json({
        success: true,
        hostname: '127.0.0.1',
      }))
    }
    if (url.hostname === 'api.pwnedpasswords.com') {
      if (externalMode === 'unavailable') {
        return Promise.resolve(new Response('unavailable', { status: 503 }))
      }
      if (externalMode === 'compromised') {
        const digest = createHash('sha1')
          .update(compromisedPassword)
          .digest('hex')
          .toUpperCase()
        return Promise.resolve(new Response(`${digest.slice(5)}:42\n`))
      }
      return Promise.resolve(new Response(''))
    }
    throw new Error(`Unexpected external request: ${url.origin}${url.pathname}`)
  }

  function request(
    path: string,
    options: {
      body?: Record<string, unknown>
      captcha?: boolean
      cookie?: string
      ip?: string
      method?: 'GET' | 'POST'
    } = {},
  ) {
    const method = options.method ?? (options.body ? 'POST' : 'GET')
    const headers = new Headers({
      origin: baseURL,
      'x-hidden-client-ip': options.ip ?? '198.51.100.10',
    })
    if (options.body) headers.set('content-type', 'application/json')
    if (options.captcha) headers.set('x-captcha-response', 'test-captcha')
    if (options.cookie) headers.set('cookie', options.cookie)
    return auth.handler(new Request(`${baseURL}/api/auth${path}`, {
      method,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }))
  }

  function signupBody(
    password: string,
    username = 'Player_ONE',
    email = 'player@example.test',
  ) {
    return {
      name: username,
      username: username.toLowerCase(),
      displayUsername: username,
      email,
      password,
      callbackURL: '/?auth=verified',
    }
  }

  async function createVerifiedAccount() {
    const signup = await request('/sign-up/email', {
      body: signupBody('GoodPass'),
      captcha: true,
    })
    expect(signup.status).toBe(200)
    const verificationURL = new URL(delivered.verification.at(-1)!.url)
    const verification = await auth.handler(new Request(verificationURL))
    expect(verification.status).toBe(302)
    return cookieFrom(verification)
  }

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schemaName}`)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE users, auth_verifications, auth_rate_limits CASCADE')
    delivered.verification.length = 0
    delivered.reset.length = 0
    delivered.emailChange.length = 0
    externalMode = 'available'
    compromisedPassword = ''
    vi.stubGlobal('fetch', externalFetch)
  })

  afterEach(() => vi.unstubAllGlobals())

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
    await adminPool.end()
  })

  it('accepts eight characters and rejects seven or more than 128', async () => {
    const tooShort = await request('/sign-up/email', {
      body: signupBody('1234567'),
      captcha: true,
      ip: '198.51.100.11',
    })
    expect(tooShort.status).toBe(400)

    const tooLong = await request('/sign-up/email', {
      body: signupBody('x'.repeat(129)),
      captcha: true,
      ip: '198.51.100.12',
    })
    expect(tooLong.status).toBe(400)

    const accepted = await request('/sign-up/email', {
      body: signupBody('GoodPass'),
      captcha: true,
      ip: '198.51.100.13',
    })
    expect(accepted.status).toBe(200)
    expect(accepted.headers.getSetCookie()).toEqual([])
    expect(delivered.verification).toHaveLength(1)
  })

  it('rejects compromised passwords and fails closed when screening is unavailable', async () => {
    compromisedPassword = 'BreachMe8'
    externalMode = 'compromised'
    const compromised = await request('/sign-up/email', {
      body: signupBody(compromisedPassword),
      captcha: true,
      ip: '198.51.100.21',
    })
    expect(compromised.status).toBe(400)
    await expect(compromised.json()).resolves.toMatchObject({
      code: 'PASSWORD_COMPROMISED',
    })

    externalMode = 'unavailable'
    const unavailable = await request('/sign-up/email', {
      body: signupBody('RetryMe88'),
      captcha: true,
      ip: '198.51.100.22',
    })
    expect(unavailable.status).toBe(500)
    const users = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users',
    )
    expect(users.rows).toEqual([{ count: '0' }])
  })

  it('verifies once, signs in by username or email, and resets while revoking every session', async () => {
    const signup = await request('/sign-up/email', {
      body: signupBody('GoodPass'),
      captcha: true,
    })
    expect(signup.status).toBe(200)
    expect(delivered.verification).toHaveLength(1)

    const unverifiedLogin = await request('/sign-in/email', {
      body: { email: 'player@example.test', password: 'GoodPass' },
    })
    expect(unverifiedLogin.status).toBe(403)
    await expect(unverifiedLogin.json()).resolves.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    })

    const verificationURL = new URL(delivered.verification[0]!.url)
    const verification = await auth.handler(new Request(verificationURL))
    expect(verification.status).toBe(302)
    const verifiedCookie = cookieFrom(verification)

    const reusedVerification = await auth.handler(new Request(verificationURL))
    expect(reusedVerification.status).toBe(302)
    expect(
      new URL(reusedVerification.headers.get('location')!).searchParams.get('error'),
    ).toBe('INVALID_TOKEN')
    expect(reusedVerification.headers.getSetCookie()).toEqual([])

    const session = await request('/get-session', { cookie: verifiedCookie })
    expect(session.status).toBe(200)
    const sessionBody = await session.json()
    expect(sessionBody).toMatchObject({
      user: {
        username: 'player_one',
        displayUsername: 'Player_ONE',
        email: 'player@example.test',
        emailVerified: true,
        role: 'player',
      },
    })

    const usernameLogin = await request('/sign-in/username', {
      body: { username: 'PLAYER_ONE', password: 'GoodPass' },
      ip: '198.51.100.31',
    })
    expect(usernameLogin.status).toBe(200)
    const usernameCookie = cookieFrom(usernameLogin)
    const emailLogin = await request('/sign-in/email', {
      body: { email: 'player@example.test', password: 'GoodPass' },
      ip: '198.51.100.32',
    })
    expect(emailLogin.status).toBe(200)
    const emailCookie = cookieFrom(emailLogin)

    const unknownRecovery = await request('/request-password-reset', {
      body: {
        email: 'missing@example.test',
        redirectTo: '/?auth=reset-password',
      },
      captcha: true,
      ip: '198.51.100.41',
    })
    const knownRecovery = await request('/request-password-reset', {
      body: {
        email: 'player@example.test',
        redirectTo: '/?auth=reset-password',
      },
      captcha: true,
      ip: '198.51.100.42',
    })
    expect(unknownRecovery.status).toBe(200)
    expect(knownRecovery.status).toBe(200)
    expect(await unknownRecovery.clone().json()).toEqual(
      await knownRecovery.clone().json(),
    )
    expect(delivered.reset).toHaveLength(1)

    const resetURL = new URL(delivered.reset[0]!.url)
    const resetToken = resetURL.pathname.split('/').at(-1)
    expect(resetToken).toBeTruthy()
    const reset = await request('/reset-password', {
      body: { token: resetToken, newPassword: 'NewPass8' },
      ip: '198.51.100.43',
    })
    expect(reset.status).toBe(200)

    const reusedReset = await request('/reset-password', {
      body: { token: resetToken, newPassword: 'OtherPas8' },
      ip: '198.51.100.44',
    })
    expect(reusedReset.status).not.toBe(200)

    for (const cookie of [verifiedCookie, usernameCookie, emailCookie]) {
      const revoked = await request('/get-session', { cookie })
      expect(await revoked.json()).toBeNull()
    }
    const newLogin = await request('/sign-in/email', {
      body: { email: 'player@example.test', password: 'NewPass8' },
      ip: '198.51.100.45',
    })
    expect(newLogin.status).toBe(200)
  })

  it('lists and revokes devices and requires a fresh session for email changes', async () => {
    const firstCookie = await createVerifiedAccount()
    const secondLogin = await request('/sign-in/email', {
      body: { email: 'player@example.test', password: 'GoodPass' },
      ip: '198.51.100.51',
    })
    expect(secondLogin.status).toBe(200)
    const secondCookie = cookieFrom(secondLogin)
    const secondToken = secondCookie
      .slice(secondCookie.indexOf('=') + 1)
      .split('.', 1)[0]!

    const listed = await request('/list-sessions', { cookie: firstCookie })
    expect(listed.status).toBe(200)
    const sessions = await listed.json() as Array<{ id: string; token: string }>
    expect(sessions).toHaveLength(2)
    expect(sessions.map(({ token }) => token)).toContain(secondToken)

    const revoked = await request('/revoke-session', {
      body: { token: secondToken },
      cookie: firstCookie,
    })
    expect(revoked.status).toBe(200)
    expect(
      await (await request('/get-session', { cookie: secondCookie })).json(),
    ).toBeNull()

    await pool.query(
      `UPDATE auth_sessions
       SET created_at = now() - interval '11 minutes'
       WHERE token <> $1`,
      [secondToken],
    )
    const staleChange = await request('/change-email', {
      body: {
        newEmail: 'new-player@example.test',
        callbackURL: '/?auth=verified',
      },
      cookie: firstCookie,
    })
    expect(staleChange.status).toBe(403)
    await expect(staleChange.json()).resolves.toMatchObject({
      code: 'SESSION_NOT_FRESH',
    })

    const freshLogin = await request('/sign-in/username', {
      body: { username: 'player_one', password: 'GoodPass' },
      ip: '198.51.100.52',
    })
    const freshCookie = cookieFrom(freshLogin)
    const emailChange = await request('/change-email', {
      body: {
        newEmail: 'new-player@example.test',
        callbackURL: '/?auth=verified',
      },
      cookie: freshCookie,
    })
    expect(emailChange.status).toBe(200)
    expect(delivered.emailChange).toHaveLength(1)

    const confirmation = await auth.handler(
      new Request(delivered.emailChange[0]!.url),
    )
    expect(confirmation.status).toBe(302)
    expect(delivered.verification.at(-1)?.to).toBe('new-player@example.test')

    const verification = await auth.handler(
      new Request(delivered.verification.at(-1)!.url),
    )
    expect(verification.status).toBe(302)
    const changed = await pool.query<{
      email: string
      email_verified: boolean
    }>('SELECT email, email_verified FROM users')
    expect(changed.rows).toEqual([
      { email: 'new-player@example.test', email_verified: true },
    ])
  })

  it('expires verification and reset tokens without creating sessions', async () => {
    const signup = await request('/sign-up/email', {
      body: signupBody('GoodPass'),
      captcha: true,
    })
    expect(signup.status).toBe(200)
    await pool.query(
      `UPDATE auth_verifications
       SET expires_at = now() - interval '1 second'
       WHERE identifier LIKE 'hidden-email-verification:%'`,
    )
    const expiredVerification = await auth.handler(
      new Request(delivered.verification[0]!.url),
    )
    expect(expiredVerification.status).toBe(302)
    expect(
      new URL(expiredVerification.headers.get('location')!).searchParams.get('error'),
    ).toBe('INVALID_TOKEN')
    expect(expiredVerification.headers.getSetCookie()).toEqual([])

    await pool.query('TRUNCATE TABLE users, auth_verifications CASCADE')
    const cookie = await createVerifiedAccount()
    const recovery = await request('/request-password-reset', {
      body: {
        email: 'player@example.test',
        redirectTo: '/?auth=reset-password',
      },
      captcha: true,
      ip: '198.51.100.61',
    })
    expect(recovery.status).toBe(200)
    const token = new URL(delivered.reset[0]!.url).pathname.split('/').at(-1)
    await pool.query(
      `UPDATE auth_verifications
       SET expires_at = now() - interval '1 second'
       WHERE identifier = $1`,
      [`reset-password:${token}`],
    )
    const expiredReset = await request('/reset-password', {
      body: { token, newPassword: 'NewPass8' },
      ip: '198.51.100.62',
    })
    expect(expiredReset.status).not.toBe(200)
    expect(
      await (await request('/get-session', { cookie })).json(),
    ).not.toBeNull()
  })

  it('keeps rate-limit state when the auth authority is recreated', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request('/sign-up/email', {
        body: signupBody('1234567'),
        captcha: true,
        ip: '198.51.100.71',
      })
      expect(response.status).toBe(400)
    }

    const restartedAuth = createHiddenAuth({
      pool,
      config,
      emails,
      overrides: { turnstileVerifyURL: 'https://turnstile.test/siteverify' },
    })
    const limited = await restartedAuth.handler(new Request(
      `${baseURL}/api/auth/sign-up/email`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseURL,
          'x-captcha-response': 'test-captcha',
          'x-hidden-client-ip': '198.51.100.71',
        },
        body: JSON.stringify(signupBody('1234567')),
      },
    ))
    expect(limited.status).toBe(429)
    const rows = await pool.query<{ count: number }>(
      `SELECT count FROM auth_rate_limits
       WHERE key LIKE '%198.51.100.71%'`,
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]!.count).toBeGreaterThanOrEqual(3)
  })
})
