import { createHash } from 'node:crypto'
import { APIError, betterAuth, type BetterAuthOptions } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { captcha } from 'better-auth/plugins'
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned'
import { username } from 'better-auth/plugins/username'
import type { Pool } from 'pg'
import type { EnabledAuthConfig } from './authConfig.js'
import type { TransactionalEmail } from './email.js'
import { INTERNAL_CLIENT_IP_HEADER } from './nodeHandler.js'
import { hashPassword, verifyPassword } from './password.js'

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/
const DISPLAY_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/
const FRESH_SESSION_SECONDS = 600
const FRESH_SESSION_PATHS = new Set([
  '/api/auth/change-email',
  '/api/auth/change-password',
  '/api/auth/revoke-session',
  '/api/auth/revoke-other-sessions',
  '/api/auth/revoke-sessions',
])

const EMAIL_TOKEN_PREFIX = 'hidden-email-verification:'

function emailTokenIdentifier(token: string) {
  return `${EMAIL_TOKEN_PREFIX}${createHash('sha256').update(token).digest('hex')}`
}

async function registerEmailToken(pool: Pool, token: string, expiresIn: number) {
  await pool.query(
    `INSERT INTO auth_verifications (identifier, value, expires_at)
     VALUES ($1, 'pending', now() + ($2 * interval '1 second'))`,
    [emailTokenIdentifier(token), expiresIn],
  )
}

async function forgetEmailToken(pool: Pool, token: string) {
  await pool.query(
    'DELETE FROM auth_verifications WHERE identifier = $1',
    [emailTokenIdentifier(token)],
  )
}

async function consumeEmailToken(pool: Pool, token: string) {
  const consumed = await pool.query(
    `DELETE FROM auth_verifications
     WHERE identifier = $1 AND expires_at > now()
     RETURNING id`,
    [emailTokenIdentifier(token)],
  )
  return consumed.rowCount === 1
}

async function deliverOneTimeEmailToken(
  pool: Pool,
  token: string,
  expiresIn: number,
  deliver: () => Promise<void>,
) {
  await registerEmailToken(pool, token, expiresIn)
  try {
    await deliver()
  } catch (error) {
    await forgetEmailToken(pool, token).catch(() => undefined)
    throw error
  }
}

function createRequestPolicy(pool: Pool) {
  return createAuthMiddleware(async (context) => {
    const body = context.body as Record<string, unknown> | undefined

    if (context.path === '/sign-up/email') {
      const username = body?.username
      const displayUsername = body?.displayUsername
      if (typeof username !== 'string' || typeof displayUsername !== 'string') {
        throw APIError.from('BAD_REQUEST', {
          code: 'USERNAME_PAIR_REQUIRED',
          message: 'Username and display username are required.',
        })
      }
      if (username !== displayUsername.toLowerCase()) {
        throw APIError.from('BAD_REQUEST', {
          code: 'USERNAME_PAIR_MISMATCH',
          message: 'Username must match the lowercase display username.',
        })
      }
    }

    if (
      context.path === '/update-user' &&
      body &&
      (Object.hasOwn(body, 'username') || Object.hasOwn(body, 'displayUsername'))
    ) {
      throw APIError.from('BAD_REQUEST', {
        code: 'USERNAME_IS_IMMUTABLE',
        message: 'Username cannot be updated.',
      })
    }

  })
}

function invalidEmailTokenResponse(
  callbackURL: string | null,
  config: EnabledAuthConfig,
) {
  if (callbackURL) {
    try {
      const target = new URL(callbackURL, config.baseURL)
      const trusted = new Set([
        new URL(config.baseURL).origin,
        ...config.allowedOrigins,
      ])
      if (trusted.has(target.origin)) {
        target.searchParams.set('error', 'INVALID_TOKEN')
        return Response.redirect(target, 302)
      }
    } catch {
      // Fall through to the non-redirect response.
    }
  }
  return Response.json(
    { code: 'INVALID_TOKEN', message: 'Invalid verification token.' },
    { status: 401 },
  )
}

export interface HiddenAuthFactoryOverrides {
  turnstileVerifyURL?: string
}

export interface HiddenAuthFactoryOptions {
  pool: Pool
  config: EnabledAuthConfig
  emails: TransactionalEmail
  overrides?: HiddenAuthFactoryOverrides
}

export function createHiddenAuthOptions({
  pool,
  config,
  emails,
  overrides = {},
}: HiddenAuthFactoryOptions): BetterAuthOptions {
  return {
    appName: 'Hidden',
    baseURL: config.baseURL,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: config.allowedOrigins,
    hooks: {
      before: createRequestPolicy(pool),
    },
    database: pool,
    user: {
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
          defaultValue: () => new Date(),
        },
      },
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        async sendChangeEmailConfirmation({ user, url, token }) {
          await deliverOneTimeEmailToken(pool, token, 3_600, () =>
            emails.sendEmailChange({ to: user.email, url }),
          )
        },
      },
    },
    account: {
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
    },
    session: {
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
      expiresIn: 2_592_000,
      updateAge: 86_400,
      freshAge: FRESH_SESSION_SECONDS,
      cookieCache: { enabled: false },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        identifier: 'identifier',
        value: 'value',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 3_600,
      async sendVerificationEmail({ user, url, token }) {
        await deliverOneTimeEmailToken(pool, token, 3_600, () =>
          emails.sendVerification({ to: user.email, url }),
        )
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      // Eight is a deliberate low-friction policy for optional game accounts,
      // backed by Argon2id, breached-password screening, verification, and
      // throttling. Raising it later requires an explicit credential-policy/reset
      // migration rather than only changing the number.
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3_600,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
      async sendResetPassword({ user, url }) {
        await emails.sendPasswordReset({ to: user.email, url })
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limits',
      fields: {
        key: 'key',
        count: 'count',
        lastRequest: 'last_request',
      },
      customRules: {
        '/sign-in/username': { max: 10, window: 900 },
        '/sign-in/email': { max: 10, window: 900 },
        '/sign-up/email': { max: 3, window: 3_600 },
        '/request-password-reset': { max: 3, window: 3_600 },
        '/send-verification-email': { max: 3, window: 3_600 },
        '/change-password': { max: 5, window: 900 },
        '/change-email': { max: 5, window: 900 },
      },
    },
    advanced: {
      useSecureCookies: false,
      trustedProxyHeaders: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.production,
        sameSite: 'strict',
        path: '/',
      },
      cookies: {
        session_token: {
          name: config.production
            ? '__Host-hidden_session'
            : 'hidden_session',
        },
      },
      database: { generateId: 'uuid' },
      ipAddress: {
        ipAddressHeaders: [INTERNAL_CLIENT_IP_HEADER],
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 24,
        immutableUsername: true,
        usernameNormalization: (value) => value.toLowerCase(),
        usernameValidator: async (value) => USERNAME_PATTERN.test(value),
        displayUsernameValidator: async (value) =>
          DISPLAY_USERNAME_PATTERN.test(value),
        validationOrder: {
          username: 'pre-normalization',
          displayUsername: 'pre-normalization',
        },
        schema: {
          user: {
            fields: {
              username: 'username',
              displayUsername: 'display_username',
            },
          },
        },
      }),
      haveIBeenPwned({
        paths: ['/sign-up/email', '/change-password', '/reset-password'],
      }),
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: config.turnstileSecretKey,
        endpoints: [
          '/sign-up/email',
          '/request-password-reset',
          '/send-verification-email',
        ],
        allowedHostnames: [new URL(config.baseURL).hostname],
        ...(overrides.turnstileVerifyURL
          ? { siteVerifyURLOverride: overrides.turnstileVerifyURL }
          : {}),
      }),
    ],
  }
}

export function createHiddenAuth(options: HiddenAuthFactoryOptions) {
  const auth = betterAuth(createHiddenAuthOptions(options))
  return {
    ...auth,
    async handler(request: Request) {
      const url = new URL(request.url)
      if (
        request.method === 'POST' &&
        FRESH_SESSION_PATHS.has(url.pathname)
      ) {
        const session = await auth.api.getSession({ headers: request.headers })
        if (session) {
          const createdAt = new Date(session.session.createdAt).getTime()
          if (Date.now() - createdAt >= FRESH_SESSION_SECONDS * 1_000) {
            return Response.json(
              {
                code: 'SESSION_NOT_FRESH',
                message: 'Session is not fresh',
              },
              { status: 403 },
            )
          }
        }
      }
      if (
        request.method === 'GET' &&
        url.pathname === '/api/auth/verify-email'
      ) {
        const token = url.searchParams.get('token')
        if (!token || !(await consumeEmailToken(options.pool, token))) {
          return invalidEmailTokenResponse(
            url.searchParams.get('callbackURL'),
            options.config,
          )
        }
      }
      return auth.handler(request)
    },
  }
}
