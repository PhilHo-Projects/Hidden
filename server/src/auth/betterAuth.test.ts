import type { Pool } from 'pg'
import { createCookieGetter } from 'better-auth/cookies'
import { describe, expect, it } from 'vitest'
import type { TransactionalEmail } from './email.js'
import {
  createHiddenAuthOptions,
  type HiddenAuthFactoryOverrides,
} from './betterAuth.js'
import type { EnabledAuthConfig } from './authConfig.js'

const CONFIG = {
  enabled: true,
  production: true,
  databaseUrl: 'postgresql://hidden:secret@postgres/hidden',
  baseURL: 'https://hidden.philippeho.dev',
  secret: '0123456789abcdef0123456789abcdef',
  resendApiKey: 're_test_only',
  emailFrom: 'Hidden <no-reply@philippeho.dev>',
  turnstileSecretKey: 'turnstile-test-only',
  allowedOrigins: ['https://hidden.philippeho.dev'],
  trustProxyHops: 1,
} satisfies EnabledAuthConfig

function createOptions(
  emails: TransactionalEmail = {
    async sendVerification() {},
    async sendPasswordReset() {},
    async sendEmailChange() {},
  },
  overrides: HiddenAuthFactoryOverrides = {},
) {
  return createHiddenAuthOptions({
    pool: {
      async query() {
        return { rowCount: 1, rows: [] }
      },
    } as unknown as Pool,
    config: CONFIG,
    emails,
    overrides,
  })
}

async function runBeforeHook(
  path: string,
  body: Record<string, unknown>,
) {
  const before = createOptions().hooks?.before
  if (!before) {
    throw new Error('Missing Hidden auth request policy hook.')
  }
  return before({ path, body } as never)
}

describe('Hidden Better Auth options', () => {
  it('maps every Better Auth model to migration 005', () => {
    const options = createOptions()

    expect(options.user).toMatchObject({
      modelName: 'users',
      fields: {
        name: 'name',
        email: 'email',
        emailVerified: 'email_verified',
        image: 'image',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        role: {
          type: 'string',
          fieldName: 'role',
          input: false,
          required: true,
          defaultValue: 'player',
        },
        lastSeenAt: {
          type: 'date',
          fieldName: 'last_seen_at',
          input: false,
          required: true,
          defaultValue: expect.any(Function),
        },
      },
    })
    expect(options.account).toMatchObject({
      modelName: 'auth_accounts',
      fields: {
        issuer: 'issuer',
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        scope: 'scope',
        password: 'password',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    })
    expect(options.session).toMatchObject({
      modelName: 'auth_sessions',
      fields: {
        expiresAt: 'expires_at',
        token: 'token',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        userId: 'user_id',
      },
    })
    expect(options.verification).toMatchObject({
      modelName: 'auth_verifications',
      fields: {
        identifier: 'identifier',
        value: 'value',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    })
    expect(options.rateLimit).toMatchObject({
      modelName: 'auth_rate_limits',
      fields: {
        key: 'key',
        count: 'count',
        lastRequest: 'last_request',
      },
    })
    expect(options.advanced?.database?.generateId).toBe('uuid')

    expect(options.user?.additionalFields?.role?.returned).not.toBe(false)
    expect(options.user?.fields?.email).toBe('email')
  })

  it('uses immutable case-preserving usernames with the exact ASCII policy', async () => {
    const usernamePlugin = createOptions().plugins?.find(
      (plugin) => plugin.id === 'username',
    )
    expect(usernamePlugin?.options).toMatchObject({
      minUsernameLength: 3,
      maxUsernameLength: 24,
      immutableUsername: true,
      schema: {
        user: {
          fields: {
            username: 'username',
            displayUsername: 'display_username',
          },
        },
      },
    })
    const usernameOptions = usernamePlugin?.options as {
      usernameNormalization(value: string): string
      usernameValidator(value: string): boolean | Promise<boolean>
      displayUsernameValidator(value: string): boolean | Promise<boolean>
    }
    expect(usernameOptions.usernameNormalization('Player_ONE')).toBe(
      'player_one',
    )
    await expect(usernameOptions.usernameValidator('abc_123')).resolves.toBe(
      true,
    )
    await expect(
      usernameOptions.usernameValidator('Player_ONE'),
    ).resolves.toBe(true)
    await expect(usernameOptions.usernameValidator('Player-One')).resolves.toBe(
      false,
    )
    await expect(usernameOptions.usernameValidator('éclair')).resolves.toBe(
      false,
    )
    await expect(
      usernameOptions.displayUsernameValidator('Player_ONE'),
    ).resolves.toBe(true)
    await expect(
      usernameOptions.displayUsernameValidator('Player-One'),
    ).resolves.toBe(false)
    expect(usernamePlugin?.options).toMatchObject({
      validationOrder: { username: 'pre-normalization' },
    })
  })

  it.each([
    ['both', {}],
    ['display username', { username: 'player_one' }],
    ['username', { displayUsername: 'Player_ONE' }],
  ])(
    'rejects email signup missing %s with a stable validation error',
    async (_missing, body) => {
      await expect(runBeforeHook('/sign-up/email', body)).rejects.toMatchObject({
        statusCode: 400,
        body: {
          code: 'USERNAME_PAIR_REQUIRED',
          message: 'Username and display username are required.',
        },
      })
    },
  )

  it.each([
    ['divergent values', 'different_player', 'Player_ONE'],
    ['non-canonical casing', 'Player_ONE', 'Player_ONE'],
  ])(
    'rejects signup usernames with %s before persistence',
    async (_case, username, displayUsername) => {
      await expect(
        runBeforeHook('/sign-up/email', { username, displayUsername }),
      ).rejects.toMatchObject({
        statusCode: 400,
        body: {
          code: 'USERNAME_PAIR_MISMATCH',
          message: 'Username must match the lowercase display username.',
        },
      })
    },
  )

  it('accepts a canonical username paired with a case-preserving display username', async () => {
    const body = {
      username: 'player_one',
      displayUsername: 'Player_ONE',
    }

    await expect(runBeforeHook('/sign-up/email', body)).resolves.toBeUndefined()
    expect(body).toEqual({
      username: 'player_one',
      displayUsername: 'Player_ONE',
    })
  })

  it.each([
    { username: 'new_player' },
    { displayUsername: 'New_Player' },
    { username: 'new_player', displayUsername: 'New_Player' },
  ])('rejects username mutation through update-user: %j', async (body) => {
    await expect(runBeforeHook('/update-user', body)).rejects.toMatchObject({
      statusCode: 400,
      body: {
        code: 'USERNAME_IS_IMMUTABLE',
        message: 'Username cannot be updated.',
      },
    })
  })

  it('uses the real Argon2id hooks and the deliberate 8-128 policy', async () => {
    const emailAndPassword = createOptions().emailAndPassword
    expect(emailAndPassword).toMatchObject({
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3_600,
      revokeSessionsOnPasswordReset: true,
    })

    const hash = await emailAndPassword?.password?.hash?.('12345678')
    expect(hash).toMatch(/^\$hidden\$argon2id\$/)
    await expect(
      emailAndPassword?.password?.verify?.({
        hash: hash!,
        password: '12345678',
      }),
    ).resolves.toBe(true)
    await expect(
      emailAndPassword?.password?.verify?.({
        hash: hash!,
        password: 'wrong-password',
      }),
    ).resolves.toBe(false)
  })

  it('delivers verification, reset, and email-change URLs through the injected provider', async () => {
    const delivered: Array<{ kind: string; to: string; url: string }> = []
    const emails: TransactionalEmail = {
      async sendVerification(message) {
        delivered.push({ kind: 'verification', ...message })
      },
      async sendPasswordReset(message) {
        delivered.push({ kind: 'reset', ...message })
      },
      async sendEmailChange(message) {
        delivered.push({ kind: 'change', ...message })
      },
    }
    const options = createOptions(emails)
    const user = {
      id: '78de2f9d-5be9-4a99-a866-a518871dcd94',
      name: 'Player',
      email: 'player@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }

    await options.emailVerification?.sendVerificationEmail?.({
      user,
      url: 'https://hidden.example/verify?token=one&callbackURL=%2F',
      token: 'one',
    })
    await options.emailAndPassword?.sendResetPassword?.({
      user,
      url: 'https://hidden.example/reset?token=two',
      token: 'two',
    })
    await options.user?.changeEmail?.sendChangeEmailConfirmation?.({
      user,
      newEmail: 'new@example.com',
      url: 'https://hidden.example/change?token=three',
      token: 'three',
    })

    expect(delivered).toEqual([
      {
        kind: 'verification',
        to: 'player@example.com',
        url: 'https://hidden.example/verify?token=one&callbackURL=%2F',
      },
      {
        kind: 'reset',
        to: 'player@example.com',
        url: 'https://hidden.example/reset?token=two',
      },
      {
        kind: 'change',
        to: 'player@example.com',
        url: 'https://hidden.example/change?token=three',
      },
    ])
    expect(options.emailVerification).toMatchObject({
      autoSignInAfterVerification: true,
      expiresIn: 3_600,
    })
    expect(options.trustedOrigins).toEqual([
      'https://hidden.philippeho.dev',
    ])
    expect(options.user?.changeEmail).toMatchObject({
      enabled: true,
      updateEmailWithoutVerification: false,
    })
  })

  it('uses durable endpoint-specific throttles and only the internal client IP', () => {
    const options = createOptions()

    expect(options.rateLimit).toMatchObject({
      enabled: true,
      storage: 'database',
      customRules: {
        '/sign-in/username': { max: 10, window: 900 },
        '/sign-in/email': { max: 10, window: 900 },
        '/sign-up/email': { max: 3, window: 3_600 },
        '/request-password-reset': { max: 3, window: 3_600 },
        '/send-verification-email': { max: 3, window: 3_600 },
        '/change-password': { max: 5, window: 900 },
        '/change-email': { max: 5, window: 900 },
      },
    })
    expect(options.advanced?.ipAddress?.ipAddressHeaders).toEqual([
      'x-hidden-client-ip',
    ])
  })

  it('enables standard HIBP checks and scopes injectable Turnstile verification', () => {
    const options = createOptions(undefined, {
      turnstileVerifyURL: 'https://turnstile.invalid/siteverify',
    })
    const pwned = options.plugins?.find(
      (plugin) => plugin.id === 'have-i-been-pwned',
    )
    const captcha = options.plugins?.find((plugin) => plugin.id === 'captcha')

    expect(pwned?.options).toEqual({
      paths: ['/sign-up/email', '/change-password', '/reset-password'],
    })
    expect(captcha?.options).toEqual({
      provider: 'cloudflare-turnstile',
      secretKey: 'turnstile-test-only',
      endpoints: [
        '/sign-up/email',
        '/request-password-reset',
        '/send-verification-email',
      ],
      allowedHostnames: ['hidden.philippeho.dev'],
      siteVerifyURLOverride: 'https://turnstile.invalid/siteverify',
    })
  })

  it('requires Turnstile only on configured endpoints without contacting the provider', async () => {
    const captchaPlugin = createOptions(undefined, {
      turnstileVerifyURL: 'https://turnstile.invalid/siteverify',
    }).plugins?.find((plugin) => plugin.id === 'captcha')
    const context = {
      options: {
        basePath: '/api/auth',
        advanced: { ipAddress: { disableIpTracking: true } },
      },
      logger: { error() {} },
    }

    const protectedResult = await captchaPlugin?.onRequest?.(
      new Request('https://hidden.example/api/auth/sign-up/email'),
      context as never,
    )
    expect(protectedResult).toHaveProperty('response')
    const protectedResponse =
      protectedResult && 'response' in protectedResult
        ? protectedResult.response
        : undefined
    expect(protectedResponse?.status).toBe(400)
    await expect(protectedResponse?.json()).resolves.toEqual({
      code: 'MISSING_RESPONSE',
      message: 'Missing CAPTCHA response',
    })

    await expect(
      captchaPlugin?.onRequest?.(
        new Request('https://hidden.example/api/auth/sign-in/email'),
        context as never,
      ),
    ).resolves.toBeUndefined()
    await expect(
      captchaPlugin?.onRequest?.(
        new Request('https://hidden.example/api/auth/sign-in/username'),
        context as never,
      ),
    ).resolves.toBeUndefined()
  })

  it('creates the exact host-only production session cookie without a second prefix', () => {
    const options = createOptions()
    const sessionCookie = createCookieGetter(options)('session_token')

    expect(sessionCookie).toEqual({
      name: '__Host-hidden_session',
      attributes: {
        secure: true,
        sameSite: 'strict',
        path: '/',
        httpOnly: true,
      },
    })
    expect(options.session).toMatchObject({
      expiresIn: 2_592_000,
      updateAge: 86_400,
      freshAge: 600,
      cookieCache: { enabled: false },
    })
  })

  it('uses the unprefixed development cookie without Secure', () => {
    const options = createHiddenAuthOptions({
      pool: {} as Pool,
      config: {
        ...CONFIG,
        production: false,
        baseURL: 'http://127.0.0.1:8080',
        allowedOrigins: ['http://127.0.0.1:5173'],
        trustProxyHops: false,
      },
      emails: {
        async sendVerification() {},
        async sendPasswordReset() {},
        async sendEmailChange() {},
      },
    })

    expect(createCookieGetter(options)('session_token')).toEqual({
      name: 'hidden_session',
      attributes: {
        secure: false,
        sameSite: 'strict',
        path: '/',
        httpOnly: true,
      },
    })
  })
})
