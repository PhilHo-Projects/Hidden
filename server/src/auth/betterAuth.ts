import { betterAuth, type BetterAuthOptions } from 'better-auth'
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
        },
        lastSeenAt: {
          type: 'date',
          fieldName: 'last_seen_at',
          input: false,
          required: true,
        },
      },
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        async sendChangeEmailConfirmation({ user, url }) {
          await emails.sendEmailChange({ to: user.email, url })
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
      freshAge: 600,
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
      async sendVerificationEmail({ user, url }) {
        await emails.sendVerification({ to: user.email, url })
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
  return betterAuth(createHiddenAuthOptions(options))
}
