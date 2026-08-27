import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabasePool } from '../database.js'
import { runMigrations } from '../migrations.js'
import { PostgresAuthCleanup } from './cleanup.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip

describeDatabase('PostgreSQL Better Auth cleanup', () => {
  const pool = createDatabasePool(databaseUrl!)
  const now = new Date('2030-01-01T00:00:00.000Z')
  const cleanup = new PostgresAuthCleanup(pool, { now: () => now })

  beforeAll(async () => runMigrations(pool))
  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE auth_rate_limits, users CASCADE')
    await pool.query(
      `INSERT INTO users (
         id, name, email, email_verified, display_username, username, created_at
       ) VALUES (
         '00000000-0000-4000-8000-000000000001', 'PlayerOne',
         'player@example.test', true, 'PlayerOne', 'playerone', now()
       )`,
    )
    await pool.query(
      `INSERT INTO auth_sessions (id, token, user_id, expires_at)
       VALUES
         ('00000000-0000-4000-8000-000000000011', 'expired', '00000000-0000-4000-8000-000000000001', $1),
         ('00000000-0000-4000-8000-000000000012', 'active', '00000000-0000-4000-8000-000000000001', $2)`,
      [new Date(now.getTime() - 1), new Date(now.getTime() + 1)],
    )
    await pool.query(
      `INSERT INTO auth_rate_limits (key, count, last_request)
       VALUES ('stale', 1, $1), ('fresh', 1, $2)`,
      [now.getTime() - 3_600_001, now.getTime() - 3_599_999],
    )
  })
  afterAll(async () => pool.end())

  it('removes only expired rows using Better Auth millisecond epochs', async () => {
    await expect(cleanup.deleteExpiredAuthState()).resolves.toEqual({
      sessions: 1,
      rateLimits: 1,
    })
    await expect(
      pool.query<{ token: string }>('SELECT token FROM auth_sessions'),
    ).resolves.toMatchObject({ rows: [{ token: 'active' }] })
    await expect(
      pool.query<{ key: string }>('SELECT key FROM auth_rate_limits'),
    ).resolves.toMatchObject({ rows: [{ key: 'fresh' }] })
  })
})
