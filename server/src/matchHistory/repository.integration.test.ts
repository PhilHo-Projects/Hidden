import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabasePool } from '../database'
import { runMigrations } from '../migrations'
import { PostgresMatchHistoryRepository } from './repository'
import type { MatchHistoryRecordV1 } from './types'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip

const ACCOUNT_ONE = '00000000-0000-4000-8000-000000000001'
const ACCOUNT_TWO = '00000000-0000-4000-8000-000000000002'
const ACCOUNT_THREE = '00000000-0000-4000-8000-000000000003'
const MATCH_ONE = '00000000-0000-4000-8000-000000000101'
const MATCH_TWO = '00000000-0000-4000-8000-000000000102'
const MATCH_THREE = '00000000-0000-4000-8000-000000000103'

function matchRecord(overrides: {
  matchId?: string
  completedAtMs?: number
  winner?: 0 | 1 | null
  scores?: [number, number]
} = {}): MatchHistoryRecordV1 {
  return {
    schemaVersion: 1,
    matchId: overrides.matchId ?? MATCH_ONE,
    completedAtMs:
      overrides.completedAtMs ?? Date.parse('2030-01-01T00:00:00.000Z'),
    engine: { id: 'classic', revision: 2 },
    config: {
      boardSize: 3,
      streak: 3,
      rounds: 1,
      turnSeconds: 10,
      blindMode: false,
      powerupsEnabled: true,
      powerups: { shield: true, reveal: true, extraTurn: true },
      powerupBySymbol: {
        rock: 'shield',
        paper: 'reveal',
        scissors: 'extraTurn',
      },
    },
    turnCount: 2,
    participants: [
      { seat: 0, accountId: ACCOUNT_ONE, username: 'Wooshylooshy' },
      { seat: 1, accountId: ACCOUNT_TWO, username: 'Friend' },
    ],
    result: {
      scores: overrides.scores ?? [2, 1],
      winner: overrides.winner === undefined ? 0 : overrides.winner,
    },
    boards: [
      {
        columns: 3,
        cells: [
          { locationId: 0, symbol: 'rock' },
          { locationId: 1, symbol: 'future-symbol' },
        ],
      },
      {
        columns: 3,
        cells: [
          { locationId: 0, symbol: null },
          { locationId: 1, symbol: 'paper' },
        ],
      },
    ],
  }
}

describeDatabase('PostgreSQL match history repository', () => {
  const pool = createDatabasePool(databaseUrl!)
  const repository = new PostgresMatchHistoryRepository(pool)

  beforeAll(async () => {
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE match_history_records, users CASCADE')
    await pool.query(
      `INSERT INTO users (id, username, username_key, password_hash, created_at)
       VALUES
         ($1, 'Wooshylooshy', 'wooshylooshy', 'hash', now()),
         ($2, 'Friend', 'friend', 'hash', now()),
         ($3, 'Observer', 'observer', 'hash', now())`,
      [ACCOUNT_ONE, ACCOUNT_TWO, ACCOUNT_THREE],
    )
  })

  afterAll(async () => {
    await pool.end()
  })

  it('inserts once and projects scores and outcomes from each participant perspective', async () => {
    const record = matchRecord()

    await repository.insert(record)
    await repository.insert(record)

    const first = await repository.listForAccount(ACCOUNT_ONE, { limit: 20 })
    const second = await repository.listForAccount(ACCOUNT_TWO, { limit: 20 })
    const counts = await pool.query<{ records: string; participants: string }>(
      `SELECT
         (SELECT count(*) FROM match_history_records)::text AS records,
         (SELECT count(*) FROM match_history_participants)::text AS participants`,
    )

    expect(first).toEqual({
      stats: { played: 1, wins: 1, losses: 0, ties: 0 },
      matches: [
        {
          matchId: MATCH_ONE,
          completedAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
          opponentName: 'Friend',
          outcome: 'win',
          playerScore: 2,
          opponentScore: 1,
          bookmarked: false,
        },
      ],
      nextCursor: null,
    })
    expect(second.matches[0]).toMatchObject({
      opponentName: 'Wooshylooshy',
      outcome: 'loss',
      playerScore: 1,
      opponentScore: 2,
    })
    expect(second.stats).toEqual({ played: 1, wins: 0, losses: 1, ties: 0 })
    expect(counts.rows[0]).toEqual({ records: '1', participants: '2' })
  })

  it('paginates newest first and filters bookmarks independently per account', async () => {
    await repository.insert(
      matchRecord({
        matchId: MATCH_ONE,
        completedAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
      }),
    )
    await repository.insert(
      matchRecord({
        matchId: MATCH_TWO,
        completedAtMs: Date.parse('2030-01-02T00:00:00.000Z'),
        winner: null,
        scores: [1, 1],
      }),
    )
    await repository.insert(
      matchRecord({
        matchId: MATCH_THREE,
        completedAtMs: Date.parse('2030-01-03T00:00:00.000Z'),
        winner: 1,
      }),
    )

    const firstPage = await repository.listForAccount(ACCOUNT_ONE, { limit: 2 })
    expect(firstPage.matches.map(({ matchId }) => matchId)).toEqual([
      MATCH_THREE,
      MATCH_TWO,
    ])
    expect(firstPage.nextCursor).toEqual({
      completedAtMs: Date.parse('2030-01-02T00:00:00.000Z'),
      matchId: MATCH_TWO,
    })

    const secondPage = await repository.listForAccount(ACCOUNT_ONE, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    })
    expect(secondPage.matches.map(({ matchId }) => matchId)).toEqual([MATCH_ONE])
    expect(secondPage.nextCursor).toBeNull()
    expect(firstPage.stats).toEqual({ played: 3, wins: 1, losses: 1, ties: 1 })

    await expect(
      repository.setBookmarked(ACCOUNT_ONE, MATCH_TWO, true),
    ).resolves.toBe(true)
    const firstBookmarks = await repository.listForAccount(ACCOUNT_ONE, {
      limit: 20,
      bookmarkedOnly: true,
    })
    const secondBookmarks = await repository.listForAccount(ACCOUNT_TWO, {
      limit: 20,
      bookmarkedOnly: true,
    })
    expect(firstBookmarks.matches.map(({ matchId }) => matchId)).toEqual([
      MATCH_TWO,
    ])
    expect(firstBookmarks.matches[0]?.bookmarked).toBe(true)
    expect(secondBookmarks.matches).toEqual([])

    await expect(
      repository.setBookmarked(ACCOUNT_ONE, MATCH_TWO, false),
    ).resolves.toBe(true)
    await expect(
      repository.setBookmarked(ACCOUNT_THREE, MATCH_TWO, true),
    ).resolves.toBe(false)
  })

  it('returns mechanics-independent detail only to authenticated participants', async () => {
    await repository.insert(matchRecord())

    const detail = await repository.getForAccount(ACCOUNT_ONE, MATCH_ONE)

    expect(detail).toMatchObject({
      matchId: MATCH_ONE,
      engine: { id: 'classic', revision: 2 },
      turnCount: 2,
      participants: [
        { seat: 0, username: 'Wooshylooshy' },
        { seat: 1, username: 'Friend' },
      ],
      result: { scores: [2, 1], winner: 0 },
      boards: [
        {
          columns: 3,
          cells: expect.arrayContaining([
            { locationId: 1, symbol: 'future-symbol' },
          ]),
        },
        { columns: 3 },
      ],
      viewerSeat: 0,
      bookmarked: false,
    })
    expect(JSON.stringify(detail)).not.toContain(ACCOUNT_ONE)
    await expect(
      repository.getForAccount(ACCOUNT_THREE, MATCH_ONE),
    ).resolves.toBeUndefined()
  })

  it('retains the username snapshot and match when an account is deleted', async () => {
    await repository.insert(matchRecord())

    await pool.query('DELETE FROM users WHERE id = $1', [ACCOUNT_ONE])

    const participant = await pool.query<{
      account_id: string | null
      username: string
    }>(
      `SELECT account_id, username
       FROM match_history_participants
       WHERE match_id = $1 AND seat = 0`,
      [MATCH_ONE],
    )
    const records = await pool.query<{ count: string }>(
      'SELECT count(*) FROM match_history_records WHERE id = $1',
      [MATCH_ONE],
    )
    expect(participant.rows[0]).toEqual({
      account_id: null,
      username: 'Wooshylooshy',
    })
    expect(records.rows[0]?.count).toBe('1')
  })
})
