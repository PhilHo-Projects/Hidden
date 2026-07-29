import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabasePool } from '../database'
import { runMigrations } from '../migrations'
import {
  PostgresAuthRepository,
  UsernameTakenError,
} from './repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip

describeDatabase('PostgreSQL auth repository', () => {
  const pool = createDatabasePool(databaseUrl!)
  const repository = new PostgresAuthRepository(pool)

  beforeAll(async () => {
    await runMigrations(pool)
    await pool.query('TRUNCATE TABLE users CASCADE')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('applies account migrations idempotently', async () => {
    await runMigrations(pool)
    const result = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    )

    expect(result.rows).toEqual([{ version: '001_accounts' }])
  })

  it('creates an account and rejects a case-insensitive duplicate', async () => {
    const expiresAt = new Date('2030-01-31T00:00:00.000Z')
    const created = await repository.createAccount({
      id: randomUUID(),
      username: 'Player_One',
      usernameKey: 'player_one',
      passwordHash: 'encoded-hash',
      sessionTokenHash: Buffer.alloc(32, 1),
      expiresAt,
      now: new Date('2030-01-01T00:00:00.000Z'),
    })

    expect(created).toMatchObject({ username: 'Player_One' })
    await expect(
      repository.createAccount({
        id: randomUUID(),
        username: 'player_one',
        usernameKey: 'player_one',
        passwordHash: 'another-hash',
        sessionTokenHash: Buffer.alloc(32, 2),
        expiresAt,
        now: new Date('2030-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(UsernameTakenError)
  })

  it('finds credentials case-insensitively and replaces only the presented session', async () => {
    const account = await repository.createAccount({
      id: randomUUID(),
      username: 'Second_Player',
      usernameKey: 'second_player',
      passwordHash: 'encoded-hash',
      sessionTokenHash: Buffer.alloc(32, 3),
      expiresAt: new Date('2030-01-31T00:00:00.000Z'),
      now: new Date('2030-01-01T00:00:00.000Z'),
    })
    await repository.createSession({
      userId: account.id,
      tokenHash: Buffer.alloc(32, 4),
      previousTokenHash: Buffer.alloc(32, 3),
      expiresAt: new Date('2030-02-01T00:00:00.000Z'),
      now: new Date('2030-01-02T00:00:00.000Z'),
    })

    await expect(
      repository.findUserByUsernameKey('second_player'),
    ).resolves.toMatchObject({
      id: account.id,
      username: 'Second_Player',
      passwordHash: 'encoded-hash',
    })
    await expect(
      repository.findSession(
        Buffer.alloc(32, 3),
        new Date('2030-01-03T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined()
    await expect(
      repository.findSession(
        Buffer.alloc(32, 4),
        new Date('2030-01-03T00:00:00.000Z'),
      ),
    ).resolves.toEqual(account)
  })

  it('replaces the presented session when registration switches accounts', async () => {
    await repository.createAccount({
      id: randomUUID(),
      username: 'Old_Account',
      usernameKey: 'old_account',
      passwordHash: 'encoded-hash',
      sessionTokenHash: Buffer.alloc(32, 7),
      expiresAt: new Date('2030-01-31T00:00:00.000Z'),
      now: new Date('2030-01-01T00:00:00.000Z'),
    })
    await repository.createAccount({
      id: randomUUID(),
      username: 'New_Account',
      usernameKey: 'new_account',
      passwordHash: 'encoded-hash',
      sessionTokenHash: Buffer.alloc(32, 8),
      previousTokenHash: Buffer.alloc(32, 7),
      expiresAt: new Date('2030-01-31T00:00:00.000Z'),
      now: new Date('2030-01-01T00:00:00.000Z'),
    })

    await expect(
      repository.findSession(
        Buffer.alloc(32, 7),
        new Date('2030-01-02T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined()
  })

  it('rejects expired sessions and deletes only the selected token', async () => {
    const account = await repository.createAccount({
      id: randomUUID(),
      username: 'Third_Player',
      usernameKey: 'third_player',
      passwordHash: 'encoded-hash',
      sessionTokenHash: Buffer.alloc(32, 5),
      expiresAt: new Date('2030-01-02T00:00:00.000Z'),
      now: new Date('2030-01-01T00:00:00.000Z'),
    })
    await repository.createSession({
      userId: account.id,
      tokenHash: Buffer.alloc(32, 6),
      expiresAt: new Date('2030-02-01T00:00:00.000Z'),
      now: new Date('2030-01-01T00:00:00.000Z'),
    })

    await expect(
      repository.findSession(
        Buffer.alloc(32, 5),
        new Date('2030-01-03T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined()
    await repository.deleteSession(Buffer.alloc(32, 6))
    await expect(
      repository.findSession(
        Buffer.alloc(32, 6),
        new Date('2030-01-03T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined()
  })
})
