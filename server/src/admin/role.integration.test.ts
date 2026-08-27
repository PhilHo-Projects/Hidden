import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabasePool } from '../database.js'
import { runMigrations } from '../migrations.js'
import { AdminRoleError, setAdminRole } from './role.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip

describeDatabase('PostgreSQL admin role operation', () => {
  const pool = createDatabasePool(databaseUrl!)

  beforeAll(async () => runMigrations(pool))
  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE users CASCADE')
    await pool.query(
      `INSERT INTO users (
         id, name, email, email_verified, display_username, username, created_at
       ) VALUES
         ('00000000-0000-4000-8000-000000000001', 'PlayerOne', 'Player@Example.test', true, 'PlayerOne', 'playerone', now()),
         ('00000000-0000-4000-8000-000000000002', 'PendingUser', 'pending@example.test', false, 'PendingUser', 'pendinguser', now())`,
    )
  })
  afterAll(async () => pool.end())

  it('promotes by canonical username and demotes by normalized email', async () => {
    await setAdminRole(pool, { identifier: 'PLAYERONE', role: 'admin' })
    await expect(
      pool.query<{ role: string }>(
        `SELECT role FROM users WHERE username = 'playerone'`,
      ),
    ).resolves.toMatchObject({ rows: [{ role: 'admin' }] })

    await setAdminRole(pool, {
      identifier: 'player@example.TEST',
      role: 'player',
    })
    await expect(
      pool.query<{ role: string }>(
        `SELECT role FROM users WHERE username = 'playerone'`,
      ),
    ).resolves.toMatchObject({ rows: [{ role: 'player' }] })
  })

  it('refuses an unverified database account', async () => {
    await expect(
      setAdminRole(pool, { identifier: 'pendinguser', role: 'admin' }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AdminRoleError>>({
        code: 'email_not_verified',
      }),
    )
  })
})
