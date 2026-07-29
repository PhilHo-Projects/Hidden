import type { Pool, PoolClient } from 'pg'

export interface AuthUser {
  id: string
  username: string
}

export interface UserWithPassword extends AuthUser {
  passwordHash: string
}

export interface CreateAccountInput {
  id: string
  username: string
  usernameKey: string
  passwordHash: string
  sessionTokenHash: Buffer
  previousTokenHash?: Buffer
  now: Date
  expiresAt: Date
}

export interface CreateSessionInput {
  userId: string
  tokenHash: Buffer
  previousTokenHash?: Buffer
  now: Date
  expiresAt: Date
}

export interface AuthRepository {
  createAccount(input: CreateAccountInput): Promise<AuthUser>
  findUserByUsernameKey(
    usernameKey: string,
  ): Promise<UserWithPassword | undefined>
  createSession(input: CreateSessionInput): Promise<void>
  findSession(tokenHash: Buffer, now: Date): Promise<AuthUser | undefined>
  deleteSession(tokenHash: Buffer): Promise<void>
  deleteExpiredSessions(now: Date): Promise<number>
}

export class UsernameTakenError extends Error {
  constructor() {
    super('Username is already registered.')
    this.name = 'UsernameTakenError'
  }
}

function isUniqueViolation(error: unknown) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505'
  )
}

async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: Pool) {}

  async createAccount(input: CreateAccountInput) {
    try {
      return await withTransaction(this.pool, async (client) => {
        if (input.previousTokenHash) {
          await client.query('DELETE FROM sessions WHERE token_hash = $1', [
            input.previousTokenHash,
          ])
        }
        const userResult = await client.query<AuthUser>(
          `INSERT INTO users (
             id, username, username_key, password_hash, created_at
           ) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, username`,
          [
            input.id,
            input.username,
            input.usernameKey,
            input.passwordHash,
            input.now,
          ],
        )
        await client.query(
          `INSERT INTO sessions (
             token_hash, user_id, created_at, last_seen_at, expires_at
           ) VALUES ($1, $2, $3, $3, $4)`,
          [
            input.sessionTokenHash,
            input.id,
            input.now,
            input.expiresAt,
          ],
        )
        return userResult.rows[0]!
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UsernameTakenError()
      }
      throw error
    }
  }

  async findUserByUsernameKey(usernameKey: string) {
    const result = await this.pool.query<{
      id: string
      username: string
      password_hash: string
    }>(
      `SELECT id, username, password_hash
       FROM users
       WHERE username_key = $1`,
      [usernameKey],
    )
    const row = result.rows[0]
    return row
      ? {
          id: row.id,
          username: row.username,
          passwordHash: row.password_hash,
        }
      : undefined
  }

  async createSession(input: CreateSessionInput) {
    await withTransaction(this.pool, async (client) => {
      if (input.previousTokenHash) {
        await client.query('DELETE FROM sessions WHERE token_hash = $1', [
          input.previousTokenHash,
        ])
      }
      await client.query(
        `INSERT INTO sessions (
           token_hash, user_id, created_at, last_seen_at, expires_at
         ) VALUES ($1, $2, $3, $3, $4)`,
        [input.tokenHash, input.userId, input.now, input.expiresAt],
      )
    })
  }

  async findSession(tokenHash: Buffer, now: Date) {
    const result = await this.pool.query<AuthUser>(
      `SELECT users.id, users.username
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1
         AND sessions.expires_at > $2`,
      [tokenHash, now],
    )
    const user = result.rows[0]
    if (!user) {
      await this.pool.query(
        'DELETE FROM sessions WHERE token_hash = $1 AND expires_at <= $2',
        [tokenHash, now],
      )
      return undefined
    }

    await this.pool.query(
      `UPDATE sessions
       SET last_seen_at = $2::timestamptz
       WHERE token_hash = $1
         AND last_seen_at < $2::timestamptz - interval '15 minutes'`,
      [tokenHash, now],
    )
    return user
  }

  async deleteSession(tokenHash: Buffer) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [
      tokenHash,
    ])
  }

  async deleteExpiredSessions(now: Date) {
    const result = await this.pool.query(
      'DELETE FROM sessions WHERE expires_at <= $1',
      [now],
    )
    return result.rowCount ?? 0
  }
}
