import { randomBytes, randomUUID } from 'node:crypto'
import {
  CredentialValidationError,
  hashPassword,
  parseCredentials,
  verifyPassword,
} from './password'
import {
  UsernameTakenError,
  type AuthRepository,
  type AuthUser,
} from './repository'
import { createSessionToken, hashSessionToken } from './sessionToken'

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000

export type UserRole = 'player' | 'admin'
export type AuthenticatedUser = AuthUser & { role: UserRole }

export type AuthServiceErrorCode =
  | 'invalid_input'
  | 'username_taken'
  | 'invalid_credentials'

export class AuthServiceError extends Error {
  constructor(
    readonly code: AuthServiceErrorCode,
    message: string,
    readonly field?: 'username' | 'password',
  ) {
    super(message)
    this.name = 'AuthServiceError'
  }
}

export interface AuthSession {
  user: AuthenticatedUser
  rawToken: string
  expiresAt: Date
}

interface AuthServiceOptions {
  adminUsernames?: ReadonlySet<string>
  now?: () => Date
  createUserId?: () => string
}

export class AuthService {
  private constructor(
    private readonly repository: AuthRepository,
    private readonly dummyPasswordHash: string,
    private readonly now: () => Date,
    private readonly createUserId: () => string,
    private readonly adminUsernames: ReadonlySet<string>,
  ) {}

  static async create(
    repository: AuthRepository,
    options: AuthServiceOptions = {},
  ) {
    const dummyPasswordHash = await hashPassword(
      randomBytes(32).toString('base64url'),
    )
    return new AuthService(
      repository,
      dummyPasswordHash,
      options.now ?? (() => new Date()),
      options.createUserId ?? randomUUID,
      options.adminUsernames ?? new Set(),
    )
  }

  async register(
    value: unknown,
    previousRawToken?: string,
  ): Promise<AuthSession> {
    let credentials
    try {
      credentials = parseCredentials(value)
    } catch (error) {
      throw this.mapValidationError(error)
    }

    const passwordHash = await hashPassword(credentials.password)
    const session = createSessionToken()
    const now = this.now()
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS)

    try {
      const user = await this.repository.createAccount({
        id: this.createUserId(),
        username: credentials.username,
        usernameKey: credentials.usernameKey,
        passwordHash,
        sessionTokenHash: session.tokenHash,
        ...(previousRawToken
          ? { previousTokenHash: hashSessionToken(previousRawToken) }
          : {}),
        now,
        expiresAt,
      })
      return {
        user: this.withRole(user),
        rawToken: session.rawToken,
        expiresAt,
      }
    } catch (error) {
      if (error instanceof UsernameTakenError) {
        throw new AuthServiceError(
          'username_taken',
          'That username is already taken.',
          'username',
        )
      }
      throw error
    }
  }

  async login(
    value: unknown,
    previousRawToken?: string,
  ): Promise<AuthSession> {
    let credentials
    try {
      credentials = parseCredentials(value)
    } catch (error) {
      throw this.mapValidationError(error)
    }

    const existing = await this.repository.findUserByUsernameKey(
      credentials.usernameKey,
    )
    const passwordMatches = await verifyPassword(
      existing?.passwordHash ?? this.dummyPasswordHash,
      credentials.password,
    )
    if (!existing || !passwordMatches) {
      throw new AuthServiceError(
        'invalid_credentials',
        'Username or password is incorrect.',
      )
    }

    const session = createSessionToken()
    const now = this.now()
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS)
    await this.repository.createSession({
      userId: existing.id,
      tokenHash: session.tokenHash,
      ...(previousRawToken
        ? { previousTokenHash: hashSessionToken(previousRawToken) }
        : {}),
      now,
      expiresAt,
    })
    return {
      user: this.withRole({ id: existing.id, username: existing.username }),
      rawToken: session.rawToken,
      expiresAt,
    }
  }

  async getSession(rawToken: string | undefined) {
    if (!rawToken) {
      return undefined
    }
    const user = await this.repository.findSession(
      hashSessionToken(rawToken),
      this.now(),
    )
    return user ? this.withRole(user) : undefined
  }

  async logout(rawToken: string | undefined) {
    if (rawToken) {
      await this.repository.deleteSession(hashSessionToken(rawToken))
    }
  }

  cleanupExpiredSessions() {
    return this.repository.deleteExpiredSessions(this.now())
  }

  private withRole(user: AuthUser): AuthenticatedUser {
    return {
      ...user,
      role: this.adminUsernames.has(user.username.trim().toLowerCase())
        ? 'admin'
        : 'player',
    }
  }

  private mapValidationError(error: unknown) {
    if (error instanceof CredentialValidationError) {
      return new AuthServiceError(
        'invalid_input',
        error.message,
        error.field,
      )
    }
    return error
  }
}
