import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../auth/password'
import { createDatabasePool } from '../database'
import { runMigrations } from '../migrations'
import {
  AdminProvisionConflictError,
  provisionAdminAccounts,
} from './provision'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip

describeDatabase('PostgreSQL administrator provisioning', () => {
  const pool = createDatabasePool(databaseUrl!)

  beforeAll(async () => {
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE users CASCADE')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('creates both accounts transactionally with independent password hashes and no sessions', async () => {
    const result = await provisionAdminAccounts(
      pool,
      ['VinceAdmin', 'PhilAdmin'],
      'correct horse battery staple',
    )
    const rows = await pool.query<{
      username: string
      password_hash: string
    }>('SELECT username, password_hash FROM users ORDER BY username')
    const sessions = await pool.query<{ count: string }>(
      'SELECT count(*) FROM sessions',
    )

    expect(result).toEqual([
      { username: 'VinceAdmin', status: 'created' },
      { username: 'PhilAdmin', status: 'created' },
    ])
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows[0]!.password_hash).not.toBe(rows.rows[1]!.password_hash)
    await expect(
      Promise.all(
        rows.rows.map((row) =>
          verifyPassword(row.password_hash, 'correct horse battery staple'),
        ),
      ),
    ).resolves.toEqual([true, true])
    expect(sessions.rows[0]?.count).toBe('0')
  })

  it('is idempotent when existing accounts already use the supplied password', async () => {
    await provisionAdminAccounts(
      pool,
      ['VinceAdmin', 'PhilAdmin'],
      'correct horse battery staple',
    )
    const before = await pool.query<{ username: string; password_hash: string }>(
      'SELECT username, password_hash FROM users ORDER BY username',
    )

    await expect(
      provisionAdminAccounts(
        pool,
        ['VinceAdmin', 'PhilAdmin'],
        'correct horse battery staple',
      ),
    ).resolves.toEqual([
      { username: 'VinceAdmin', status: 'existing' },
      { username: 'PhilAdmin', status: 'existing' },
    ])
    const after = await pool.query<{ username: string; password_hash: string }>(
      'SELECT username, password_hash FROM users ORDER BY username',
    )
    expect(after.rows).toEqual(before.rows)
  })

  it('refuses a conflicting account and rolls back accounts created earlier in the transaction', async () => {
    await pool.query(
      `INSERT INTO users (
         id, username, username_key, password_hash, created_at, last_seen_at
       ) VALUES (
         '00000000-0000-4000-8000-000000000001',
         'PhilAdmin',
         'philadmin',
         $1,
         now(),
         now()
       )`,
      [await hashPassword('different password')],
    )

    await expect(
      provisionAdminAccounts(
        pool,
        ['VinceAdmin', 'PhilAdmin'],
        'correct horse battery staple',
      ),
    ).rejects.toBeInstanceOf(AdminProvisionConflictError)

    const users = await pool.query<{ username: string }>(
      'SELECT username FROM users ORDER BY username',
    )
    expect(users.rows).toEqual([{ username: 'PhilAdmin' }])
  })
})
