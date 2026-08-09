import type {
  MatchHistoryBoard,
  MatchHistoryDetail,
  MatchHistoryPage,
  MatchHistoryParticipant,
  MatchHistoryStats,
  MatchHistorySummary,
} from './types'

export type MatchHistoryErrorCode =
  | 'account_required'
  | 'invalid_input'
  | 'match_not_found'
  | 'history_unavailable'

export class MatchHistoryApiError extends Error {
  constructor(
    readonly code: MatchHistoryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MatchHistoryApiError'
  }
}

type Fetcher = typeof fetch

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object.')
  }
  return value as Record<string, unknown>
}

function string(value: unknown) {
  if (typeof value !== 'string') throw new Error('Expected a string.')
  return value
}

function boolean(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('Expected a boolean.')
  return value
}

function integer(value: unknown, minimum = 0) {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error('Expected an integer.')
  }
  return value as number
}

function seat(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Expected a seat.')
  return value
}

function completedAt(value: unknown) {
  const parsed = string(value)
  if (
    !Number.isFinite(Date.parse(parsed)) ||
    new Date(parsed).toISOString() !== parsed
  ) {
    throw new Error('Expected an ISO completion time.')
  }
  return parsed
}

function stats(value: unknown): MatchHistoryStats {
  const input = record(value)
  return {
    played: integer(input.played),
    wins: integer(input.wins),
    losses: integer(input.losses),
    ties: integer(input.ties),
  }
}

function summary(value: unknown): MatchHistorySummary {
  const input = record(value)
  const outcome = input.outcome
  if (outcome !== 'win' && outcome !== 'loss' && outcome !== 'tie') {
    throw new Error('Expected a match outcome.')
  }
  return {
    matchId: string(input.matchId),
    completedAt: completedAt(input.completedAt),
    opponentName: string(input.opponentName),
    outcome,
    playerScore: integer(input.playerScore),
    opponentScore: integer(input.opponentScore),
    bookmarked: boolean(input.bookmarked),
  }
}

function page(value: unknown): MatchHistoryPage {
  const input = record(value)
  if (!Array.isArray(input.matches)) throw new Error('Expected match rows.')
  if (input.nextCursor !== null && typeof input.nextCursor !== 'string') {
    throw new Error('Expected a history cursor.')
  }
  return {
    stats: stats(input.stats),
    matches: input.matches.map(summary),
    nextCursor: input.nextCursor,
  }
}

function participant(value: unknown): MatchHistoryParticipant {
  const input = record(value)
  return { seat: seat(input.seat), username: string(input.username) }
}

function board(value: unknown): MatchHistoryBoard {
  const input = record(value)
  if (!Array.isArray(input.cells)) throw new Error('Expected history cells.')
  return {
    columns: integer(input.columns, 1),
    cells: input.cells.map((cell) => {
      const item = record(cell)
      if (item.symbol !== null && typeof item.symbol !== 'string') {
        throw new Error('Expected a historical symbol.')
      }
      return {
        locationId: integer(item.locationId),
        symbol: item.symbol,
      }
    }),
  }
}

function detail(value: unknown): MatchHistoryDetail {
  const envelope = record(value)
  const input = record(envelope.match)
  const engine = record(input.engine)
  const result = record(input.result)
  if (!Array.isArray(input.participants) || input.participants.length !== 2) {
    throw new Error('Expected two historical participants.')
  }
  if (!Array.isArray(input.boards) || input.boards.length !== 2) {
    throw new Error('Expected two historical boards.')
  }
  if (!Array.isArray(result.scores) || result.scores.length !== 2) {
    throw new Error('Expected two historical scores.')
  }
  const winner = result.winner
  if (winner !== null && winner !== 0 && winner !== 1) {
    throw new Error('Expected a historical winner.')
  }
  return {
    matchId: string(input.matchId),
    completedAt: completedAt(input.completedAt),
    engine: {
      id: string(engine.id),
      revision: integer(engine.revision, 1),
    },
    config: input.config,
    turnCount: integer(input.turnCount),
    participants: [
      participant(input.participants[0]),
      participant(input.participants[1]),
    ],
    result: {
      scores: [integer(result.scores[0]), integer(result.scores[1])],
      winner,
    },
    boards: [board(input.boards[0]), board(input.boards[1])],
    viewerSeat: seat(input.viewerSeat),
    bookmarked: boolean(input.bookmarked),
  }
}

const KNOWN_ERROR_CODES = new Set<MatchHistoryErrorCode>([
  'account_required',
  'invalid_input',
  'match_not_found',
  'history_unavailable',
])

function unavailable() {
  return new MatchHistoryApiError(
    'history_unavailable',
    'Match history is temporarily unavailable.',
  )
}

export function createMatchHistoryClient(fetcher: Fetcher = fetch) {
  async function request<T>(
    url: string,
    init: RequestInit,
    decode: (value: unknown) => T,
  ) {
    let response: Response
    try {
      response = await fetcher(url, init)
    } catch {
      throw unavailable()
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw unavailable()
    }

    if (!response.ok) {
      try {
        const error = record(body).error
        const errorBody = record(error)
        const code = errorBody.code
        const message = errorBody.message
        if (
          typeof code === 'string' &&
          KNOWN_ERROR_CODES.has(code as MatchHistoryErrorCode) &&
          typeof message === 'string'
        ) {
          throw new MatchHistoryApiError(code as MatchHistoryErrorCode, message)
        }
      } catch (error) {
        if (error instanceof MatchHistoryApiError) throw error
      }
      throw unavailable()
    }

    try {
      return decode(body)
    } catch {
      throw unavailable()
    }
  }

  return {
    list(
      options: { bookmarkedOnly?: boolean; cursor?: string } = {},
    ) {
      const query = new URLSearchParams()
      if (options.bookmarkedOnly) query.set('bookmarked', 'true')
      if (options.cursor) query.set('cursor', options.cursor)
      const suffix = query.size > 0 ? `?${query.toString()}` : ''
      return request(
        `/api/history${suffix}`,
        { headers: { Accept: 'application/json' } },
        page,
      )
    },
    get(matchId: string) {
      return request(
        `/api/history/${encodeURIComponent(matchId)}`,
        { headers: { Accept: 'application/json' } },
        detail,
      )
    },
    setBookmarked(matchId: string, bookmarked: boolean) {
      return request(
        `/api/history/${encodeURIComponent(matchId)}/bookmark`,
        {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ bookmarked }),
        },
        (value) => boolean(record(value).bookmarked),
      )
    },
  }
}

export type MatchHistoryClient = ReturnType<typeof createMatchHistoryClient>
