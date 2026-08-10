import type { Pool } from 'pg'
import type { Seat } from '@hidden/game-core'
import type { MatchHistoryBoard } from '../matchHistory/types'
import type {
  AdminAccountPage,
  AdminAccountSummary,
  AdminMatchDetail,
  AdminMatchPage,
  AdminMatchParticipant,
  AdminMatchSummary,
  AdminRepository,
  ListAdminAccountsOptions,
  ListAdminMatchesOptions,
} from './repository'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface MatchRow {
  id: string
  schema_version?: number
  completed_at: Date
  completed_cursor?: string
  engine_id: string
  engine_revision: number
  config_snapshot?: unknown
  turn_count: number
  winner_seat: Seat | null
  seat_0_score: number
  seat_1_score: number
  final_boards?: [MatchHistoryBoard, MatchHistoryBoard]
  participants: AdminMatchParticipant[]
  bookmark_count: number
}

interface AccountRow {
  id: string
  username: string
  created_at: Date
  created_cursor: string
  last_seen_at: Date | null
  active_session_count: string
  match_count: string
}

function participants(row: MatchRow) {
  if (row.participants.length !== 2) {
    throw new Error('Stored admin match does not have two participants.')
  }
  return [row.participants[0]!, row.participants[1]!] as const
}

function matchSummary(row: MatchRow): AdminMatchSummary {
  return {
    matchId: row.id,
    completedAtMs: row.completed_at.getTime(),
    engine: { id: row.engine_id, revision: row.engine_revision },
    turnCount: row.turn_count,
    participants: participants(row),
    result: {
      scores: [row.seat_0_score, row.seat_1_score],
      winner: row.winner_seat,
    },
    bookmarkCount: Number(row.bookmark_count),
  }
}

function escapeLikePrefix(value: string | null) {
  return (
    value
      ?.replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_') ?? null
  )
}

export class PostgresAdminRepository implements AdminRepository {
  constructor(
    private readonly pool: Pool,
    private readonly adminUsernames: ReadonlySet<string>,
  ) {}

  async getStorageStats(now: Date) {
    const result = await this.pool.query<{
      accounts: string
      active_sessions: string
      matches: string
    }>(
      `SELECT
         (SELECT count(*) FROM users)::text AS accounts,
         (SELECT count(*) FROM sessions WHERE expires_at > $1)::text
           AS active_sessions,
         (SELECT count(*) FROM match_history_records)::text AS matches`,
      [now],
    )
    const row = result.rows[0] ?? {
      accounts: '0',
      active_sessions: '0',
      matches: '0',
    }
    return {
      accounts: Number(row.accounts),
      activeSessions: Number(row.active_sessions),
      matches: Number(row.matches),
    }
  }

  async listMatches(options: ListAdminMatchesOptions): Promise<AdminMatchPage> {
    const query = options.query
    const matchId = query && UUID_PATTERN.test(query) ? query : null
    const usernamePrefix = escapeLikePrefix(query && !matchId ? query : null)
    const cursorDate = options.cursor?.completedAt ?? null
    const cursorMatchId = options.cursor?.matchId ?? null
    const result = await this.pool.query<MatchRow>(
      `SELECT
         r.id,
         r.completed_at,
         to_char(
           r.completed_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
         ) AS completed_cursor,
         r.engine_id,
         r.engine_revision,
         r.turn_count,
         r.winner_seat,
         r.seat_0_score,
         r.seat_1_score,
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'seat', participant.seat,
               'accountId', participant.account_id,
               'username', participant.username
             ) ORDER BY participant.seat
           )
           FROM match_history_participants participant
           WHERE participant.match_id = r.id
         ) AS participants,
         (
           SELECT count(*)::integer
           FROM match_history_bookmarks bookmark
           WHERE bookmark.match_id = r.id
         ) AS bookmark_count
       FROM match_history_records r
       WHERE ($1::uuid IS NULL OR r.id = $1::uuid)
         AND (
           $2::text IS NULL OR EXISTS (
             SELECT 1
             FROM match_history_participants search_participant
             WHERE search_participant.match_id = r.id
               AND lower(search_participant.username) LIKE $2::text || '%' ESCAPE '\\'
           )
         )
         AND (
           $3::timestamptz IS NULL OR
           (r.completed_at, r.id) < ($3::timestamptz, $4::uuid)
         )
       ORDER BY r.completed_at DESC, r.id DESC
       LIMIT $5`,
      [
        matchId,
        usernamePrefix,
        cursorDate,
        cursorMatchId,
        options.limit + 1,
      ],
    )
    const hasNext = result.rows.length > options.limit
    const visible = result.rows.slice(0, options.limit)
    const last = visible.at(-1)
    return {
      items: visible.map(matchSummary),
      nextCursor:
        hasNext && last
          ? { completedAt: last.completed_cursor!, matchId: last.id }
          : null,
    }
  }

  async getMatch(matchId: string): Promise<AdminMatchDetail | undefined> {
    const result = await this.pool.query<MatchRow>(
      `SELECT
         r.id,
         r.schema_version,
         r.completed_at,
         r.engine_id,
         r.engine_revision,
         r.config_snapshot,
         r.turn_count,
         r.winner_seat,
         r.seat_0_score,
         r.seat_1_score,
         r.final_boards,
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'seat', participant.seat,
               'accountId', participant.account_id,
               'username', participant.username
             ) ORDER BY participant.seat
           )
           FROM match_history_participants participant
           WHERE participant.match_id = r.id
         ) AS participants,
         (
           SELECT count(*)::integer
           FROM match_history_bookmarks bookmark
           WHERE bookmark.match_id = r.id
         ) AS bookmark_count
       FROM match_history_records r
       WHERE r.id = $1`,
      [matchId],
    )
    const row = result.rows[0]
    if (!row) return undefined
    return {
      ...matchSummary(row),
      schemaVersion: row.schema_version!,
      config: row.config_snapshot,
      boards: row.final_boards!,
    }
  }

  async listAccounts(
    options: ListAdminAccountsOptions,
  ): Promise<AdminAccountPage> {
    const cursorDate = options.cursor?.createdAt ?? null
    const cursorAccountId = options.cursor?.accountId ?? null
    const result = await this.pool.query<AccountRow>(
      `SELECT
         u.id,
         u.username,
         u.created_at,
         to_char(
           u.created_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
         ) AS created_cursor,
         u.last_seen_at,
         (
           SELECT count(*)
           FROM sessions session
           WHERE session.user_id = u.id AND session.expires_at > now()
         )::text AS active_session_count,
         (
           SELECT count(*)
           FROM match_history_participants participant
           WHERE participant.account_id = u.id
         )::text AS match_count
       FROM users u
       WHERE ($1::text IS NULL OR u.username_key LIKE $1::text || '%' ESCAPE '\\')
         AND (
           $2::timestamptz IS NULL OR
           (u.created_at, u.id) < ($2::timestamptz, $3::uuid)
         )
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $4`,
      [
        escapeLikePrefix(options.query ?? null),
        cursorDate,
        cursorAccountId,
        options.limit + 1,
      ],
    )
    const hasNext = result.rows.length > options.limit
    const visible = result.rows.slice(0, options.limit)
    const items = visible.map(
      (row): AdminAccountSummary => ({
        id: row.id,
        username: row.username,
        role: this.adminUsernames.has(row.username.trim().toLowerCase())
          ? 'admin'
          : 'player',
        createdAtMs: row.created_at.getTime(),
        lastSeenAtMs: row.last_seen_at?.getTime() ?? null,
        activeSessionCount: Number(row.active_session_count),
        matchCount: Number(row.match_count),
      }),
    )
    const last = visible.at(-1)
    return {
      items,
      nextCursor:
        hasNext && last
          ? { createdAt: last.created_cursor, accountId: last.id }
          : null,
    }
  }
}
