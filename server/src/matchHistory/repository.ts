import type { Pool, PoolClient } from 'pg'
import type { Seat } from '@hidden/game-core'
import type {
  MatchHistoryBoard,
  MatchHistoryRecordV1,
} from './types'

export type MatchHistoryOutcome = 'win' | 'loss' | 'tie'

export interface MatchHistoryStats {
  readonly played: number
  readonly wins: number
  readonly losses: number
  readonly ties: number
}

export interface MatchHistoryCursor {
  readonly completedAtMs: number
  readonly matchId: string
}

export interface MatchHistorySummary {
  readonly matchId: string
  readonly completedAtMs: number
  readonly opponentName: string
  readonly outcome: MatchHistoryOutcome
  readonly playerScore: number
  readonly opponentScore: number
  readonly bookmarked: boolean
}

export interface MatchHistoryPage {
  readonly stats: MatchHistoryStats
  readonly matches: readonly MatchHistorySummary[]
  readonly nextCursor: MatchHistoryCursor | null
}

export interface MatchHistoryDetail {
  readonly matchId: string
  readonly completedAtMs: number
  readonly engine: { readonly id: string; readonly revision: number }
  readonly config: unknown
  readonly turnCount: number
  readonly participants: readonly [
    { readonly seat: Seat; readonly username: string },
    { readonly seat: Seat; readonly username: string },
  ]
  readonly result: {
    readonly scores: readonly [number, number]
    readonly winner: Seat | null
  }
  readonly boards: readonly [MatchHistoryBoard, MatchHistoryBoard]
  readonly viewerSeat: Seat
  readonly bookmarked: boolean
}

export interface ListMatchHistoryOptions {
  readonly limit: number
  readonly cursor?: MatchHistoryCursor
  readonly bookmarkedOnly?: boolean
}

export interface MatchHistoryRepository {
  insert(record: MatchHistoryRecordV1): Promise<void>
  listForAccount(
    accountId: string,
    options: ListMatchHistoryOptions,
  ): Promise<MatchHistoryPage>
  getForAccount(
    accountId: string,
    matchId: string,
  ): Promise<MatchHistoryDetail | undefined>
  setBookmarked(
    accountId: string,
    matchId: string,
    bookmarked: boolean,
  ): Promise<boolean>
}

interface StatsRow {
  played: string
  wins: string
  losses: string
  ties: string
}

interface SummaryRow {
  id: string
  completed_at: Date
  winner_seat: Seat | null
  seat_0_score: number
  seat_1_score: number
  viewer_seat: Seat
  opponent_name: string
  bookmarked: boolean
}

interface DetailRow {
  id: string
  completed_at: Date
  engine_id: string
  engine_revision: number
  config_snapshot: unknown
  turn_count: number
  winner_seat: Seat | null
  seat_0_score: number
  seat_1_score: number
  final_boards: [MatchHistoryBoard, MatchHistoryBoard]
  viewer_seat: Seat
  bookmarked: boolean
}

interface ParticipantRow {
  seat: Seat
  username: string
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

function outcome(winner: Seat | null, viewerSeat: Seat): MatchHistoryOutcome {
  if (winner === null) return 'tie'
  return winner === viewerSeat ? 'win' : 'loss'
}

function perspectiveScores(
  row: Pick<SummaryRow, 'seat_0_score' | 'seat_1_score' | 'viewer_seat'>,
) {
  return row.viewer_seat === 0
    ? { playerScore: row.seat_0_score, opponentScore: row.seat_1_score }
    : { playerScore: row.seat_1_score, opponentScore: row.seat_0_score }
}

export class PostgresMatchHistoryRepository implements MatchHistoryRepository {
  constructor(private readonly pool: Pool) {}

  async insert(record: MatchHistoryRecordV1): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO match_history_records (
           id, schema_version, completed_at, engine_id, engine_revision,
           config_snapshot, turn_count, winner_seat, seat_0_score,
           seat_1_score, final_boards
         ) VALUES (
           $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb
         )
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          record.matchId,
          record.schemaVersion,
          new Date(record.completedAtMs),
          record.engine.id,
          record.engine.revision,
          JSON.stringify(record.config),
          record.turnCount,
          record.result.winner,
          record.result.scores[0],
          record.result.scores[1],
          JSON.stringify(record.boards),
        ],
      )
      if (inserted.rowCount === 0) return

      for (const participant of record.participants) {
        await client.query(
          `INSERT INTO match_history_participants (
             match_id, seat, account_id, username
           ) VALUES (
             $1, $2,
             (SELECT id FROM users WHERE id = $3::uuid),
             $4
           )`,
          [
            record.matchId,
            participant.seat,
            participant.accountId ?? null,
            participant.username,
          ],
        )
      }
    })
  }

  async listForAccount(
    accountId: string,
    options: ListMatchHistoryOptions,
  ): Promise<MatchHistoryPage> {
    const cursorDate = options.cursor
      ? new Date(options.cursor.completedAtMs)
      : null
    const cursorMatchId = options.cursor?.matchId ?? null
    const bookmarkedOnly = options.bookmarkedOnly ?? false
    const [statsResult, matchesResult] = await Promise.all([
      this.pool.query<StatsRow>(
        `SELECT
           count(*)::text AS played,
           count(*) FILTER (WHERE r.winner_seat = p.seat)::text AS wins,
           count(*) FILTER (
             WHERE r.winner_seat IS NOT NULL AND r.winner_seat <> p.seat
           )::text AS losses,
           count(*) FILTER (WHERE r.winner_seat IS NULL)::text AS ties
         FROM match_history_participants p
         JOIN match_history_records r ON r.id = p.match_id
         WHERE p.account_id = $1`,
        [accountId],
      ),
      this.pool.query<SummaryRow>(
        `SELECT
           r.id,
           r.completed_at,
           r.winner_seat,
           r.seat_0_score,
           r.seat_1_score,
           self.seat AS viewer_seat,
           opponent.username AS opponent_name,
           (bookmark.user_id IS NOT NULL) AS bookmarked
         FROM match_history_records r
         JOIN match_history_participants self
           ON self.match_id = r.id AND self.account_id = $1
         JOIN match_history_participants opponent
           ON opponent.match_id = r.id AND opponent.seat <> self.seat
         LEFT JOIN match_history_bookmarks bookmark
           ON bookmark.match_id = r.id AND bookmark.user_id = $1
         WHERE ($2::boolean = false OR bookmark.user_id IS NOT NULL)
           AND (
             $3::timestamptz IS NULL OR
             (r.completed_at, r.id) < ($3::timestamptz, $4::uuid)
           )
         ORDER BY r.completed_at DESC, r.id DESC
         LIMIT $5`,
        [
          accountId,
          bookmarkedOnly,
          cursorDate,
          cursorMatchId,
          options.limit + 1,
        ],
      ),
    ])

    const statsRow = statsResult.rows[0] ?? {
      played: '0',
      wins: '0',
      losses: '0',
      ties: '0',
    }
    const hasNext = matchesResult.rows.length > options.limit
    const visibleRows = matchesResult.rows.slice(0, options.limit)
    const matches = visibleRows.map((row): MatchHistorySummary => ({
      matchId: row.id,
      completedAtMs: row.completed_at.getTime(),
      opponentName: row.opponent_name,
      outcome: outcome(row.winner_seat, row.viewer_seat),
      ...perspectiveScores(row),
      bookmarked: row.bookmarked,
    }))
    const last = visibleRows.at(-1)

    return {
      stats: {
        played: Number(statsRow.played),
        wins: Number(statsRow.wins),
        losses: Number(statsRow.losses),
        ties: Number(statsRow.ties),
      },
      matches,
      nextCursor:
        hasNext && last
          ? { completedAtMs: last.completed_at.getTime(), matchId: last.id }
          : null,
    }
  }

  async getForAccount(
    accountId: string,
    matchId: string,
  ): Promise<MatchHistoryDetail | undefined> {
    const record = await this.pool.query<DetailRow>(
      `SELECT
         r.id,
         r.completed_at,
         r.engine_id,
         r.engine_revision,
         r.config_snapshot,
         r.turn_count,
         r.winner_seat,
         r.seat_0_score,
         r.seat_1_score,
         r.final_boards,
         self.seat AS viewer_seat,
         (bookmark.user_id IS NOT NULL) AS bookmarked
       FROM match_history_records r
       JOIN match_history_participants self
         ON self.match_id = r.id AND self.account_id = $1
       LEFT JOIN match_history_bookmarks bookmark
         ON bookmark.match_id = r.id AND bookmark.user_id = $1
       WHERE r.id = $2`,
      [accountId, matchId],
    )
    const row = record.rows[0]
    if (!row) return undefined

    const participants = await this.pool.query<ParticipantRow>(
      `SELECT seat, username
       FROM match_history_participants
       WHERE match_id = $1
       ORDER BY seat`,
      [matchId],
    )
    if (participants.rows.length !== 2) {
      throw new Error('Stored match history record does not have two participants.')
    }

    return {
      matchId: row.id,
      completedAtMs: row.completed_at.getTime(),
      engine: { id: row.engine_id, revision: row.engine_revision },
      config: row.config_snapshot,
      turnCount: row.turn_count,
      participants: [participants.rows[0]!, participants.rows[1]!],
      result: {
        scores: [row.seat_0_score, row.seat_1_score],
        winner: row.winner_seat,
      },
      boards: row.final_boards,
      viewerSeat: row.viewer_seat,
      bookmarked: row.bookmarked,
    }
  }

  async setBookmarked(
    accountId: string,
    matchId: string,
    bookmarked: boolean,
  ): Promise<boolean> {
    const participant = await this.pool.query(
      `SELECT 1
       FROM match_history_participants
       WHERE match_id = $1 AND account_id = $2`,
      [matchId, accountId],
    )
    if (participant.rowCount === 0) return false

    if (bookmarked) {
      await this.pool.query(
        `INSERT INTO match_history_bookmarks (match_id, user_id, created_at)
         VALUES ($1, $2, now())
         ON CONFLICT (match_id, user_id) DO NOTHING`,
        [matchId, accountId],
      )
    } else {
      await this.pool.query(
        `DELETE FROM match_history_bookmarks
         WHERE match_id = $1 AND user_id = $2`,
        [matchId, accountId],
      )
    }
    return true
  }
}
