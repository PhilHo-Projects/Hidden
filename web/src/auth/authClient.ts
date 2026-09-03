import { createAuthClient as createBetterAuthClient } from 'better-auth/react'
import {
  inferAdditionalFields,
  usernameClient,
} from 'better-auth/client/plugins'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/

export interface AuthUser {
  id: string
  role: 'player' | 'admin'
  username: string
}

export interface AuthAccount {
  user: AuthUser
  email: string
  emailVerified: boolean
  currentSessionId: string
}

export interface AccountDeviceSession {
  id: string
  token: string
  current: boolean
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  ipAddress?: string
  userAgent?: string
}

export interface RegistrationInput {
  username: string
  email: string
  password: string
  captchaToken: string
}

export type AuthErrorCode =
  | 'invalid_input'
  | 'username_taken'
  | 'email_taken'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'compromised_password'
  | 'invalid_token'
  | 'captcha_failed'
  | 'rate_limited'
  | 'session_expired'
  | 'account_service_unavailable'

export class AuthApiError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AuthApiError'
  }
}

type Fetcher = typeof fetch

function authBaseURL() {
  return typeof window === 'undefined'
    ? 'http://localhost'
    : window.location.origin
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined
}

function validDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function mapAccount(value: unknown): AuthAccount | null {
  if (value === null) return null
  const root = record(value)
  const user = record(root?.user)
  const session = record(root?.session)
  if (
    typeof user?.id !== 'string' ||
    !UUID_PATTERN.test(user.id) ||
    typeof user.displayUsername !== 'string' ||
    !USERNAME_PATTERN.test(user.displayUsername) ||
    (user.role !== 'player' && user.role !== 'admin') ||
    typeof user.email !== 'string' ||
    !user.email.includes('@') ||
    typeof user.emailVerified !== 'boolean' ||
    typeof session?.id !== 'string' ||
    !UUID_PATTERN.test(session.id)
  ) {
    throw new AuthApiError(
      'account_service_unavailable',
      'Accounts are temporarily unavailable.',
    )
  }
  return {
    user: {
      id: user.id,
      username: user.displayUsername,
      role: user.role,
    },
    email: user.email,
    emailVerified: user.emailVerified,
    currentSessionId: session.id,
  }
}

function mapDeviceSession(
  value: unknown,
  currentSessionId: string,
): AccountDeviceSession {
  const session = record(value)
  const createdAt = validDate(session?.createdAt)
  const updatedAt = validDate(session?.updatedAt)
  const expiresAt = validDate(session?.expiresAt)
  if (
    typeof session?.id !== 'string' ||
    !UUID_PATTERN.test(session.id) ||
    typeof session.token !== 'string' ||
    !session.token ||
    !createdAt ||
    !updatedAt ||
    !expiresAt
  ) {
    throw new AuthApiError(
      'account_service_unavailable',
      'Account sessions are temporarily unavailable.',
    )
  }
  return {
    id: session.id,
    token: session.token,
    current: session.id === currentSessionId,
    createdAt,
    updatedAt,
    expiresAt,
    ...(typeof session.ipAddress === 'string'
      ? { ipAddress: session.ipAddress }
      : {}),
    ...(typeof session.userAgent === 'string'
      ? { userAgent: session.userAgent }
      : {}),
  }
}

function hiddenError(cause: unknown) {
  if (cause instanceof AuthApiError) return cause
  const failure = record(cause)
  const provider = record(failure?.error)
  const providerCode = typeof provider?.code === 'string'
    ? provider.code
    : undefined
  const status = typeof failure?.status === 'number' ? failure.status : undefined

  if (status === 429) {
    return new AuthApiError(
      'rate_limited',
      'Too many attempts. Wait a bit and try again.',
    )
  }
  switch (providerCode) {
    case 'INVALID_USERNAME_OR_PASSWORD':
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
      return new AuthApiError(
        'invalid_credentials',
        'Username/email or password is incorrect.',
      )
    case 'EMAIL_NOT_VERIFIED':
      return new AuthApiError(
        'email_not_verified',
        'Verify your email before signing in.',
      )
    case 'USERNAME_IS_ALREADY_TAKEN':
      return new AuthApiError(
        'username_taken',
        'That username is already claimed.',
      )
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
    case 'USER_ALREADY_EXISTS':
      return new AuthApiError(
        'email_taken',
        'That email is already attached to an account.',
      )
    case 'PASSWORD_COMPROMISED':
    case 'PASSWORD_PWNED':
      return new AuthApiError(
        'compromised_password',
        'That password appears in known breaches. Choose a different one.',
      )
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return new AuthApiError(
        'invalid_token',
        'That secure link is invalid or has expired.',
      )
    case 'CAPTCHA_VERIFICATION_FAILED':
    case 'CAPTCHA_RESPONSE_MISSING':
      return new AuthApiError(
        'captcha_failed',
        'The bot check did not complete. Please try it again.',
      )
    case 'SESSION_EXPIRED':
    case 'UNAUTHORIZED':
      return new AuthApiError(
        'session_expired',
        'Your session expired. Sign in again.',
      )
    default:
      return new AuthApiError(
        'account_service_unavailable',
        'Accounts are temporarily unavailable.',
      )
  }
}

export function createAuthClient(fetcher: Fetcher = fetch) {
  const sdk = createBetterAuthClient({
    baseURL: authBaseURL(),
    basePath: '/api/auth',
    plugins: [
      usernameClient(),
      inferAdditionalFields({
        user: {
          role: { type: 'string', input: false },
          lastSeenAt: { type: 'date', input: false },
        },
      }),
    ],
    fetchOptions: {
      credentials: 'include',
      customFetchImpl: fetcher,
      throw: true,
    },
  })

  async function attempt<T>(operation: () => Promise<T>) {
    try {
      return await operation()
    } catch (cause) {
      throw hiddenError(cause)
    }
  }

  async function getSession() {
    return attempt(async () => mapAccount(await sdk.getSession()))
  }

  return {
    getSession,
    register(input: RegistrationInput) {
      return attempt(async () => {
        const email = input.email.trim().toLowerCase()
        const displayUsername = input.username.trim()
        await sdk.signUp.email(
          {
            name: displayUsername,
            username: displayUsername.toLowerCase(),
            displayUsername,
            email,
            password: input.password,
            callbackURL: '/?auth=verified',
          },
          { headers: { 'x-captcha-response': input.captchaToken } },
        )
        return { email }
      })
    },
    login(identifier: string, password: string) {
      return attempt(async () => {
        const normalized = identifier.trim()
        if (normalized.includes('@')) {
          await sdk.signIn.email({
            email: normalized.toLowerCase(),
            password,
          })
        } else {
          await sdk.signIn.username({ username: normalized, password })
        }
        const account = await getSession()
        if (!account) {
          throw new AuthApiError(
            'account_service_unavailable',
            'Accounts are temporarily unavailable.',
          )
        }
        return account
      })
    },
    requestPasswordReset(email: string, captchaToken: string) {
      return attempt(async () => {
        await sdk.requestPasswordReset(
          {
            email: email.trim().toLowerCase(),
            redirectTo: '/?auth=reset-password',
          },
          { headers: { 'x-captcha-response': captchaToken } },
        )
      })
    },
    resendVerification(email: string, captchaToken: string) {
      return attempt(async () => {
        await sdk.sendVerificationEmail(
          {
            email: email.trim().toLowerCase(),
            callbackURL: '/?auth=verified',
          },
          { headers: { 'x-captcha-response': captchaToken } },
        )
      })
    },
    resetPassword(token: string, newPassword: string) {
      return attempt(async () => {
        await sdk.resetPassword({ token, newPassword })
      })
    },
    changePassword(currentPassword: string, newPassword: string) {
      return attempt(async () => {
        await sdk.changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        })
      })
    },
    changeEmail(newEmail: string) {
      return attempt(async () => {
        await sdk.changeEmail({
          newEmail: newEmail.trim().toLowerCase(),
          callbackURL: '/?auth=verified',
        })
      })
    },
    listSessions(currentSessionId: string) {
      return attempt(async () => {
        const sessions = await sdk.listSessions()
        if (!Array.isArray(sessions)) {
          throw new AuthApiError(
            'account_service_unavailable',
            'Account sessions are temporarily unavailable.',
          )
        }
        return sessions.map((session) =>
          mapDeviceSession(session, currentSessionId),
        )
      })
    },
    revokeSession(token: string) {
      return attempt(async () => {
        await sdk.revokeSession({ token })
      })
    },
    signOutOtherSessions() {
      return attempt(async () => {
        await sdk.revokeOtherSessions({})
      })
    },
    logout() {
      return attempt(async () => {
        await sdk.signOut({})
      })
    },
  }
}

export type AuthClient = ReturnType<typeof createAuthClient>
