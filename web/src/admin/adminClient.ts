import type {
  AdminAccountSummary,
  AdminCursorPage,
  AdminMatchBoard,
  AdminMatchDetail,
  AdminMatchParticipant,
  AdminMatchSummary,
  AdminStats,
} from './types'

export type AdminApiErrorCode =
  | 'account_required'
  | 'admin_required'
  | 'invalid_input'
  | 'match_not_found'
  | 'admin_unavailable'

export class AdminApiError extends Error {
  constructor(
    readonly code: AdminApiErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AdminApiError'
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

function nullableString(value: unknown) {
  if (value === null) return null
  return string(value)
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

function isoDate(value: unknown) {
  const parsed = string(value)
  if (
    !Number.isFinite(Date.parse(parsed)) ||
    new Date(parsed).toISOString() !== parsed
  ) {
    throw new Error('Expected an ISO timestamp.')
  }
  return parsed
}

function nullableIsoDate(value: unknown) {
  return value === null ? null : isoDate(value)
}

function participant(value: unknown): AdminMatchParticipant {
  const input = record(value)
  return {
    seat: seat(input.seat),
    accountId: nullableString(input.accountId),
    username: string(input.username),
  }
}

function summary(value: unknown): AdminMatchSummary {
  const input = record(value)
  const engine = record(input.engine)
  const result = record(input.result)
  if (!Array.isArray(input.participants) || input.participants.length !== 2) {
    throw new Error('Expected two participants.')
  }
  if (!Array.isArray(result.scores) || result.scores.length !== 2) {
    throw new Error('Expected two scores.')
  }
  const winner = result.winner
  if (winner !== null && winner !== 0 && winner !== 1) {
    throw new Error('Expected a winner seat.')
  }
  return {
    matchId: string(input.matchId),
    completedAt: isoDate(input.completedAt),
    engine: {
      id: string(engine.id),
      revision: integer(engine.revision, 1),
    },
    turnCount: integer(input.turnCount),
    participants: [participant(input.participants[0]), participant(input.participants[1])],
    result: {
      scores: [integer(result.scores[0]), integer(result.scores[1])],
      winner,
    },
    bookmarkCount: integer(input.bookmarkCount),
  }
}

function board(value: unknown): AdminMatchBoard {
  const input = record(value)
  if (!Array.isArray(input.cells)) throw new Error('Expected board cells.')
  return {
    columns: integer(input.columns, 1),
    cells: input.cells.map((value) => {
      const cell = record(value)
      return {
        locationId: integer(cell.locationId),
        symbol: nullableString(cell.symbol),
      }
    }),
  }
}

function matchDetail(value: unknown): AdminMatchDetail {
  const input = record(record(value).match)
  if (!Array.isArray(input.boards) || input.boards.length !== 2) {
    throw new Error('Expected two boards.')
  }
  return {
    ...summary(input),
    schemaVersion: integer(input.schemaVersion, 1),
    config: input.config,
    boards: [board(input.boards[0]), board(input.boards[1])],
  }
}

function account(value: unknown): AdminAccountSummary {
  const input = record(value)
  if (input.role !== 'player' && input.role !== 'admin') {
    throw new Error('Expected an account role.')
  }
  return {
    id: string(input.id),
    username: string(input.username),
    role: input.role,
    createdAt: isoDate(input.createdAt),
    lastSeenAt: nullableIsoDate(input.lastSeenAt),
    activeSessionCount: integer(input.activeSessionCount),
    matchCount: integer(input.matchCount),
  }
}

function page<T>(value: unknown, decode: (item: unknown) => T): AdminCursorPage<T> {
  const input = record(value)
  if (!Array.isArray(input.items)) throw new Error('Expected page items.')
  if (input.nextCursor !== null && typeof input.nextCursor !== 'string') {
    throw new Error('Expected a cursor.')
  }
  return {
    items: input.items.map(decode),
    nextCursor: input.nextCursor,
  }
}

function stats(value: unknown): AdminStats {
  const input = record(value)
  const runtime = record(input.runtime)
  const storage = record(input.storage)
  return {
    capturedAt: isoDate(input.capturedAt),
    runtime: {
      connections: integer(runtime.connections),
      onlinePlayers: integer(runtime.onlinePlayers),
      namedPlayers: integer(runtime.namedPlayers),
      authenticatedPlayers: integer(runtime.authenticatedPlayers),
      guestPlayers: integer(runtime.guestPlayers),
      queuedPlayers: integer(runtime.queuedPlayers),
      pendingLobbies: integer(runtime.pendingLobbies),
      activeMatches: integer(runtime.activeMatches),
    },
    storage: {
      accounts: integer(storage.accounts),
      activeSessions: integer(storage.activeSessions),
      matches: integer(storage.matches),
    },
  }
}

const ERROR_CODES = new Set<AdminApiErrorCode>([
  'account_required',
  'admin_required',
  'invalid_input',
  'match_not_found',
  'admin_unavailable',
])

function unavailable() {
  return new AdminApiError(
    'admin_unavailable',
    'The admin workspace is temporarily unavailable.',
  )
}

export function createAdminClient(fetcher: Fetcher = fetch) {
  async function request<T>(url: string, decode: (value: unknown) => T) {
    let response: Response
    try {
      response = await fetcher(url, { headers: { Accept: 'application/json' } })
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
        const error = record(record(body).error)
        if (
          typeof error.code === 'string' &&
          ERROR_CODES.has(error.code as AdminApiErrorCode) &&
          typeof error.message === 'string'
        ) {
          throw new AdminApiError(
            error.code as AdminApiErrorCode,
            error.message,
          )
        }
      } catch (error) {
        if (error instanceof AdminApiError) throw error
      }
      throw unavailable()
    }

    try {
      return decode(body)
    } catch {
      throw unavailable()
    }
  }

  function listUrl(
    resource: 'matches' | 'accounts',
    options: { query?: string; cursor?: string },
  ) {
    const query = new URLSearchParams()
    if (options.query) query.set('q', options.query)
    if (options.cursor) query.set('cursor', options.cursor)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return `/api/admin/${resource}${suffix}`
  }

  return {
    getStats() {
      return request('/api/admin/stats', stats)
    },
    listMatches(options: { query?: string; cursor?: string } = {}) {
      return request(listUrl('matches', options), (value) =>
        page(value, summary),
      )
    },
    getMatch(matchId: string) {
      return request(
        `/api/admin/matches/${encodeURIComponent(matchId)}`,
        matchDetail,
      )
    },
    listAccounts(options: { query?: string; cursor?: string } = {}) {
      return request(listUrl('accounts', options), (value) =>
        page(value, account),
      )
    },
  }
}

export type AdminClient = ReturnType<typeof createAdminClient>
