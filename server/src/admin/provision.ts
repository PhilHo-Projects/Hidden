import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  hashPassword,
  parseCredentials,
  verifyPassword,
} from '../auth/password'

export class AdminProvisionConflictError extends Error {
  constructor(readonly username: string) {
    super(`Administrator account ${username} already exists with another password.`)
    this.name = 'AdminProvisionConflictError'
  }
}

export interface AdminProvisionResult {
  readonly username: string
  readonly status: 'created' | 'existing'
}

export async function provisionAdminAccounts(
  pool: Pool,
  usernames: readonly string[],
  password: string,
): Promise<AdminProvisionResult[]> {
  if (usernames.length === 0) {
    throw new Error('At least one administrator username is required.')
  }
  const credentials = usernames.map((username) =>
    parseCredentials({ username, password }),
  )
  const uniqueKeys = new Set(credentials.map(({ usernameKey }) => usernameKey))
  if (uniqueKeys.size !== credentials.length) {
    throw new Error('Administrator usernames must be unique.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existingResult = await client.query<{
      username: string
      username_key: string
      password_hash: string
    }>(
      `SELECT username, username_key, password_hash
       FROM users
       WHERE username_key = ANY($1::varchar[])
       FOR UPDATE`,
      [[...uniqueKeys]],
    )
    const existingByKey = new Map(
      existingResult.rows.map((row) => [row.username_key, row]),
    )
    const result: AdminProvisionResult[] = []
    const now = new Date()

    for (const account of credentials) {
      const existing = existingByKey.get(account.usernameKey)
      if (existing) {
        if (!(await verifyPassword(existing.password_hash, account.password))) {
          throw new AdminProvisionConflictError(existing.username)
        }
        result.push({ username: account.username, status: 'existing' })
        continue
      }

      await client.query(
        `INSERT INTO users (
           id, username, username_key, password_hash, created_at, last_seen_at
         ) VALUES ($1, $2, $3, $4, $5, $5)`,
        [
          randomUUID(),
          account.username,
          account.usernameKey,
          await hashPassword(account.password),
          now,
        ],
      )
      result.push({ username: account.username, status: 'created' })
    }

    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
