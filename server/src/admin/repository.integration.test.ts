import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabasePool } from '../database'
import { runMigrations } from '../migrations'
import { PostgresMatchHistoryRepository } from '../matchHistory/repository'
import type { MatchHistoryRecordV1 } from '../matchHistory/types'
import { PostgresAdminRepository } from './postgresRepository'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const PLAYER_ID = '00000000-0000-4000-8000-000000000002'
const MATCH_ONE = '00000000-0000-4000-8000-000000000101'
const MATCH_TWO = '00000000-0000-4000-8000-000000000102'
const MATCH_UNDERSCORE = '00000000-0000-4000-8000-000000000103'
const MATCH_WILDCARD_NEIGHBOR = '00000000-0000-4000-8000-000000000104'

function record(
  matchId: string,
  completedAt: string,
  second: { accountId?: string; username: string },
): MatchHistoryRecordV1 {
  return {
    schemaVersion: 1,
    matchId,
    completedAtMs: Date.parse(completedAt),
    engine: { id: 'classic', revision: 1 },
    config: {
      boardSize: 3,
      streak: 3,
      rounds: 2,
      turnSeconds: 10,
      blindMode: false,
      powerupsEnabled: false,
      powerups: { shield: true, reveal: true, extraTurn: true },
      powerupBySymbol: {
        rock: 'shield',
        paper: 'reveal',
        scissors: 'extraTurn',
      },
    },
    turnCount: 4,
    participants: [
      { seat: 0, accountId: ADMIN_ID, username: 'PhilAdmin' },
      { seat: 1, ...second },
    ],
    result: { scores: [3, 1], winner: 0 },
    boards: [
      { columns: 3, cells: [{ locationId: 0, symbol: 'rock' }] },
      { columns: 3, cells: [{ locationId: 0, symbol: null }] },
    ],
  }
}

describeDatabase('PostgreSQL admin repository', () => {
  const pool = createDatabasePool(databaseUrl!)
  const history = new PostgresMatchHistoryRepository(pool)
  const repository = new PostgresAdminRepository(
    pool,
    new Set(['philadmin', 'vinceadmin']),
  )

  beforeAll(async () => {
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE match_history_records, users CASCADE')
    await pool.query(
      `INSERT INTO users (
         id, username, username_key, password_hash, created_at, last_seen_at
       ) VALUES
         ($1, 'PhilAdmin', 'philadmin', 'hash-a', '2029-01-01T00:00:00Z', '2029-01-01T00:00:00Z'),
         ($2, 'PlayerOne', 'playerone', 'hash-b', '2029-01-02T00:00:00Z', '2030-01-02T00:00:00Z')`,
      [ADMIN_ID, PLAYER_ID],
    )
    await pool.query(
      `INSERT INTO sessions (
         token_hash, user_id, created_at, last_seen_at, expires_at
       ) VALUES
         ($1, $2, '2029-01-02T00:00:00Z', '2030-01-02T00:00:00Z', '2031-01-01T00:00:00Z'),
         ($3, $2, '2025-01-02T00:00:00Z', '2025-01-03T00:00:00Z', '2025-02-01T00:00:00Z')`,
      [Buffer.alloc(32, 1), PLAYER_ID, Buffer.alloc(32, 2)],
    )
    await history.insert(
      record(MATCH_ONE, '2030-01-01T00:00:00Z', {
        accountId: PLAYER_ID,
        username: 'PlayerOne',
      }),
    )
    await history.insert(
      record(MATCH_TWO, '2030-01-02T00:00:00Z', {
        username: 'Guest#1234',
      }),
    )
    await pool.query(
      `INSERT INTO match_history_bookmarks (match_id, user_id, created_at)
       VALUES ($1, $2, now()), ($1, $3, now())`,
      [MATCH_ONE, ADMIN_ID, PLAYER_ID],
    )
  })

  afterAll(async () => {
    await pool.end()
  })

  it('reports storage counts and only unexpired sessions', async () => {
    await expect(
      repository.getStorageStats(new Date('2030-06-01T00:00:00Z')),
    ).resolves.toEqual({ accounts: 2, activeSessions: 1, matches: 2 })
  })

  it('lists account and guest matches newest first with search and keyset pagination', async () => {
    const first = await repository.listMatches({ limit: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.items[0]).toMatchObject({
      matchId: MATCH_TWO,
      participants: [
        { accountId: ADMIN_ID, username: 'PhilAdmin' },
        { accountId: null, username: 'Guest#1234' },
      ],
      bookmarkCount: 0,
    })
    expect(first.nextCursor).toEqual({
      completedAt: '2030-01-02T00:00:00.000000Z',
      matchId: MATCH_TWO,
    })

    const second = await repository.listMatches({
      limit: 1,
      cursor: first.nextCursor!,
    })
    expect(second.items[0]).toMatchObject({
      matchId: MATCH_ONE,
      bookmarkCount: 2,
    })
    expect(second.nextCursor).toBeNull()

    await expect(
      repository.listMatches({ limit: 50, query: 'guest' }),
    ).resolves.toMatchObject({ items: [{ matchId: MATCH_TWO }] })
    await expect(
      repository.listMatches({ limit: 50, query: 'guest#1234' }),
    ).resolves.toMatchObject({ items: [{ matchId: MATCH_TWO }] })
    await expect(
      repository.listMatches({ limit: 50, query: MATCH_ONE }),
    ).resolves.toMatchObject({ items: [{ matchId: MATCH_ONE }] })

    await history.insert(
      record(MATCH_UNDERSCORE, '2028-01-02T00:00:00Z', {
        username: 'Guest_1234',
      }),
    )
    await history.insert(
      record(MATCH_WILDCARD_NEIGHBOR, '2028-01-01T00:00:00Z', {
        username: 'GuestX1234',
      }),
    )
    const literalUnderscore = await repository.listMatches({
      limit: 50,
      query: 'guest_',
    })
    expect(literalUnderscore.items.map(({ matchId }) => matchId)).toEqual([
      MATCH_UNDERSCORE,
    ])
  })

  it('returns complete global detail without participant authorization', async () => {
    await expect(repository.getMatch(MATCH_TWO)).resolves.toMatchObject({
      matchId: MATCH_TWO,
      schemaVersion: 1,
      config: { boardSize: 3 },
      boards: [{ columns: 3 }, { columns: 3 }],
      participants: [
        { accountId: ADMIN_ID },
        { accountId: null, username: 'Guest#1234' },
      ],
    })
  })

  it('lists safe account aggregates, derived roles, prefix search, and cursors', async () => {
    const first = await repository.listAccounts({ limit: 1 })
    expect(first.items[0]).toMatchObject({
      id: PLAYER_ID,
      username: 'PlayerOne',
      role: 'player',
      lastSeenAtMs: Date.parse('2030-01-02T00:00:00Z'),
      activeSessionCount: 1,
      matchCount: 1,
    })
    expect(first.nextCursor).toEqual({
      createdAt: '2029-01-02T00:00:00.000000Z',
      accountId: PLAYER_ID,
    })

    const filtered = await repository.listAccounts({
      limit: 50,
      query: 'phil',
    })
    expect(filtered.items).toEqual([
      expect.objectContaining({
        id: ADMIN_ID,
        username: 'PhilAdmin',
        role: 'admin',
        activeSessionCount: 0,
        matchCount: 2,
      }),
    ])
    expect(JSON.stringify(filtered)).not.toMatch(/password|token|hash/i)

    await pool.query(
      `INSERT INTO users (id, username, username_key, password_hash, created_at, last_seen_at)
       VALUES
         ('00000000-0000-4000-8000-000000000003', 'Player_Two', 'player_two', 'hash-c', '2028-01-02T00:00:00Z', '2028-01-02T00:00:00Z'),
         ('00000000-0000-4000-8000-000000000004', 'PlayerXTwo', 'playerxtwo', 'hash-d', '2028-01-01T00:00:00Z', '2028-01-01T00:00:00Z')`,
    )
    const literalUnderscore = await repository.listAccounts({
      limit: 50,
      query: 'player_',
    })
    expect(literalUnderscore.items.map(({ username }) => username)).toEqual([
      'Player_Two',
    ])

    await pool.query('DELETE FROM sessions WHERE user_id = $1', [PLAYER_ID])
    const afterSessionCleanup = await repository.listAccounts({
      limit: 50,
      query: 'playerone',
    })
    expect(afterSessionCleanup.items[0]?.lastSeenAtMs).toBe(
      Date.parse('2030-01-02T00:00:00Z'),
    )
  })

  it('does not skip equal or microsecond timestamp rows at cursor boundaries', async () => {
    await pool.query(
      `UPDATE match_history_records
       SET completed_at = '2030-02-01T00:00:00.123456Z'
       WHERE id = ANY($1::uuid[])`,
      [[MATCH_ONE, MATCH_TWO]],
    )
    const firstMatches = await repository.listMatches({ limit: 1 })
    expect(firstMatches.items[0]?.matchId).toBe(MATCH_TWO)
    expect(firstMatches.nextCursor).toEqual({
      completedAt: '2030-02-01T00:00:00.123456Z',
      matchId: MATCH_TWO,
    })
    const secondMatches = await repository.listMatches({
      limit: 1,
      cursor: firstMatches.nextCursor!,
    })
    expect(secondMatches.items[0]?.matchId).toBe(MATCH_ONE)

    await pool.query(
      `UPDATE users
       SET created_at = '2031-02-01T00:00:00.654321Z'
       WHERE id = ANY($1::uuid[])`,
      [[ADMIN_ID, PLAYER_ID]],
    )
    const firstAccounts = await repository.listAccounts({ limit: 1 })
    expect(firstAccounts.items[0]?.id).toBe(PLAYER_ID)
    expect(firstAccounts.nextCursor).toEqual({
      createdAt: '2031-02-01T00:00:00.654321Z',
      accountId: PLAYER_ID,
    })
    const secondAccounts = await repository.listAccounts({
      limit: 1,
      cursor: firstAccounts.nextCursor!,
    })
    expect(secondAccounts.items[0]?.id).toBe(ADMIN_ID)
  })
})
