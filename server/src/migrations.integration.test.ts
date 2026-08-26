import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip

describeDatabase('Better Auth migration', () => {
  const schemaName = `hidden_better_auth_${randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
  })
  const migrationsDirectory = path.resolve('migrations')
  let legacyMigrationsDirectory: string

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schemaName}`)
    legacyMigrationsDirectory = await mkdtemp(
      path.join(tmpdir(), 'hidden-legacy-migrations-'),
    )
    for (const migration of [
      '001_accounts.sql',
      '002_match_history.sql',
      '003_admin_workbench_indexes.sql',
      '004_user_last_seen.sql',
    ]) {
      await copyFile(
        path.join(migrationsDirectory, migration),
        path.join(legacyMigrationsDirectory, migration),
      )
    }
    await runMigrations(pool, legacyMigrationsDirectory)

    await pool.query(
      `INSERT INTO users (
         id, username, username_key, password_hash, created_at, last_seen_at
       ) VALUES (
         '10000000-0000-4000-8000-000000000001',
         'Legacy_Player',
         'legacy_player',
         'legacy-password-hash',
         '2030-01-01T00:00:00.000Z',
         '2030-01-02T00:00:00.000Z'
       )`,
    )
    await pool.query(
      `INSERT INTO sessions (
         token_hash, user_id, created_at, last_seen_at, expires_at
       ) VALUES (
         decode(repeat('01', 32), 'hex'),
         '10000000-0000-4000-8000-000000000001',
         '2030-01-01T00:00:00.000Z',
         '2030-01-02T00:00:00.000Z',
         '2030-02-01T00:00:00.000Z'
       )`,
    )
    await pool.query(
      `INSERT INTO match_history_records (
         id, schema_version, completed_at, engine_id, engine_revision,
         config_snapshot, turn_count, winner_seat, seat_0_score,
         seat_1_score, final_boards
       ) VALUES (
         '20000000-0000-4000-8000-000000000002',
         1,
         '2030-01-03T00:00:00.000Z',
         'hidden',
         1,
         '{}'::jsonb,
         4,
         0,
         10,
         8,
         '[]'::jsonb
       )`,
    )
    await pool.query(
      `INSERT INTO match_history_participants (
         match_id, seat, account_id, username
       ) VALUES (
         '20000000-0000-4000-8000-000000000002',
         0,
         '10000000-0000-4000-8000-000000000001',
         'Legacy_Player'
       )`,
    )
    await pool.query(
      `INSERT INTO match_history_bookmarks (match_id, user_id, created_at)
       VALUES (
         '20000000-0000-4000-8000-000000000002',
         '10000000-0000-4000-8000-000000000001',
         '2030-01-04T00:00:00.000Z'
       )`,
    )

    await runMigrations(pool, migrationsDirectory)
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
    await adminPool.end()
    if (legacyMigrationsDirectory) {
      await rm(legacyMigrationsDirectory, { force: true, recursive: true })
    }
  })

  it('removes legacy accounts and auth data without changing match snapshots', async () => {
    const legacyUsers = await pool.query('SELECT id FROM users')
    const legacySessions = await pool.query<{ relation: string | null }>(
      `SELECT to_regclass('sessions')::text AS relation`,
    )
    const bookmarks = await pool.query(
      'SELECT match_id FROM match_history_bookmarks',
    )
    const matches = await pool.query<{
      completed_at: Date
      config_snapshot: Record<string, never>
      engine_id: string
      engine_revision: number
      final_boards: never[]
      id: string
      schema_version: number
      seat_0_score: number
      seat_1_score: number
      turn_count: number
      winner_seat: number
    }>(
      `SELECT id, schema_version, completed_at, engine_id, engine_revision,
              config_snapshot, turn_count, winner_seat, seat_0_score,
              seat_1_score, final_boards
       FROM match_history_records`,
    )
    const participants = await pool.query<{
      account_id: string | null
      username: string
    }>(
      `SELECT account_id, username
       FROM match_history_participants`,
    )

    expect(legacyUsers.rows).toEqual([])
    expect(legacySessions.rows).toEqual([{ relation: null }])
    expect(bookmarks.rows).toEqual([])
    expect(matches.rows).toEqual([
      {
        completed_at: new Date('2030-01-03T00:00:00.000Z'),
        config_snapshot: {},
        engine_id: 'hidden',
        engine_revision: 1,
        final_boards: [],
        id: '20000000-0000-4000-8000-000000000002',
        schema_version: 1,
        seat_0_score: 10,
        seat_1_score: 8,
        turn_count: 4,
        winner_seat: 0,
      },
    ])
    expect(participants.rows).toEqual([
      { account_id: null, username: 'Legacy_Player' },
    ])
  })

  it('stores Better Auth users, credentials, sessions, verifications, and rate limits', async () => {
    const userId = '30000000-0000-4000-8000-000000000003'
    await pool.query(
      `INSERT INTO users (
         id, name, email, email_verified, image, created_at, updated_at,
         username, display_username, role, last_seen_at
       ) VALUES (
         $1, 'Current Player', 'player@example.com', true, NULL,
         '2030-02-01T00:00:00.000Z', '2030-02-01T00:00:00.000Z',
         'current_player', 'Current_Player', 'player',
         '2030-02-01T00:00:00.000Z'
       )`,
      [userId],
    )
    await pool.query(
      `INSERT INTO auth_accounts (
         id, issuer, account_id, provider_id, user_id, password,
         created_at, updated_at
       ) VALUES (
         '40000000-0000-4000-8000-000000000004',
         'credential', 'player@example.com', 'credential', $1,
         'argon2id-hash', '2030-02-01T00:00:00.000Z',
         '2030-02-01T00:00:00.000Z'
       )`,
      [userId],
    )
    await pool.query(
      `INSERT INTO auth_sessions (
         id, expires_at, token, created_at, updated_at, ip_address,
         user_agent, user_id
       ) VALUES (
         '50000000-0000-4000-8000-000000000005',
         '2030-03-01T00:00:00.000Z', 'session-token',
         '2030-02-01T00:00:00.000Z', '2030-02-01T00:00:00.000Z',
         '127.0.0.1', 'migration-test', $1
       )`,
      [userId],
    )
    await pool.query(
      `INSERT INTO auth_verifications (
         id, identifier, value, expires_at, created_at, updated_at
       ) VALUES (
         '60000000-0000-4000-8000-000000000006',
         'player@example.com', 'verification-token',
         '2030-02-02T00:00:00.000Z', '2030-02-01T00:00:00.000Z',
         '2030-02-01T00:00:00.000Z'
       )`,
    )
    await expect(
      pool.query<{ id: string }>(
        `INSERT INTO auth_rate_limits (key, count, last_request)
         VALUES ('sign-up:127.0.0.1', 1, 1893456000000)
         RETURNING id`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
        },
      ],
    })

    const authRows = await pool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM auth_accounts) +
         (SELECT count(*) FROM auth_sessions) +
         (SELECT count(*) FROM auth_verifications) +
         (SELECT count(*) FROM auth_rate_limits)
       )::text AS count`,
    )
    expect(authRows.rows).toEqual([{ count: '4' }])

    await pool.query('DELETE FROM users WHERE id = $1', [userId])
    const dependentRows = await pool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM auth_accounts) +
         (SELECT count(*) FROM auth_sessions)
       )::text AS count`,
    )
    expect(dependentRows.rows).toEqual([{ count: '0' }])
  })

  it('enforces public identity, role, uniqueness, and ownership constraints', async () => {
    const insertUser = (overrides: {
      displayUsername?: string
      email?: string
      id: string
      role?: string
      username?: string
    }) =>
      pool.query(
        `INSERT INTO users (
           id, name, email, email_verified, created_at, updated_at,
           username, display_username, role, last_seen_at
         ) VALUES (
           $1, 'Constraint Test', $2, false,
           '2030-02-01T00:00:00.000Z', '2030-02-01T00:00:00.000Z',
           $3, $4, $5, '2030-02-01T00:00:00.000Z'
         )`,
        [
          overrides.id,
          overrides.email ?? 'constraint@example.com',
          overrides.username ?? 'constraint_user',
          overrides.displayUsername ?? 'Constraint_User',
          overrides.role ?? 'player',
        ],
      )

    await insertUser({ id: '80000000-0000-4000-8000-000000000008' })
    await expect(
      insertUser({
        email: 'another@example.com',
        id: '80000000-0000-4000-8000-000000000009',
      }),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      insertUser({
        id: '80000000-0000-4000-8000-000000000010',
        username: 'Mixed_Case',
      }),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insertUser({
        id: '80000000-0000-4000-8000-000000000011',
        displayUsername: 'bad-name',
        username: 'valid_name',
      }),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insertUser({
        id: '80000000-0000-4000-8000-000000000012',
        role: 'owner',
        username: 'valid_role',
      }),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insertUser({
        displayUsername: 'Different_Name',
        email: 'different@example.com',
        id: '80000000-0000-4000-8000-000000000013',
        username: 'valid_name',
      }),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      pool.query(
        `INSERT INTO auth_sessions (
           id, expires_at, token, created_at, updated_at, user_id
         ) VALUES (
           '90000000-0000-4000-8000-000000000009',
           '2030-03-01T00:00:00.000Z', 'orphan-token',
           '2030-02-01T00:00:00.000Z', '2030-02-01T00:00:00.000Z',
           'ffffffff-ffff-4fff-8fff-ffffffffffff'
         )`,
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })
})
