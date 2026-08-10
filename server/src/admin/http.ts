import express, { type Response } from 'express'
import type { AuthenticatedUser } from '../auth/service'
import { readSessionToken } from '../auth/sessionToken'
import type { Logger } from '../logger'
import type {
  AdminAccountCursor,
  AdminAccountSummary,
  AdminMatchCursor,
  AdminMatchDetail,
  AdminMatchSummary,
  AdminRepository,
  AdminRuntimeStatsProvider,
} from './repository'

const PAGE_SIZE = 50
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const USERNAME_PREFIX_PATTERN = /^[a-z0-9_#]{1,24}$/
const CURSOR_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/

type AdminErrorCode =
  | 'account_required'
  | 'admin_required'
  | 'invalid_input'
  | 'match_not_found'
  | 'admin_unavailable'

interface AdminRouterOptions {
  readonly getSession: (
    token: string | undefined,
  ) => Promise<AuthenticatedUser | undefined>
  readonly repository: AdminRepository
  readonly runtimeStats: AdminRuntimeStatsProvider
  readonly logger: Logger
  readonly secureCookie: boolean
  readonly now?: () => Date
}

function sendError(
  response: Response,
  status: number,
  code: AdminErrorCode,
  message: string,
) {
  response.status(status).json({ error: { code, message } })
}

function errorClass(error: unknown) {
  return error instanceof Error ? error.name : typeof error
}

function isCursorTimestamp(value: string) {
  const match = CURSOR_TIMESTAMP_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  )
}

function encodeCursor(
  kind: 'match' | 'account',
  cursor: AdminMatchCursor | AdminAccountCursor,
) {
  const identity =
    kind === 'match'
      ? (cursor as AdminMatchCursor).matchId
      : (cursor as AdminAccountCursor).accountId
  const at =
    kind === 'match'
      ? (cursor as AdminMatchCursor).completedAt
      : (cursor as AdminAccountCursor).createdAt
  return Buffer.from(JSON.stringify([kind, at, identity]), 'utf8').toString(
    'base64url',
  )
}

function decodeCursor(
  kind: 'match',
  value: unknown,
): AdminMatchCursor | undefined
function decodeCursor(
  kind: 'account',
  value: unknown,
): AdminAccountCursor | undefined
function decodeCursor(kind: 'match' | 'account', value: unknown) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    return undefined
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      parsed[0] !== kind ||
      typeof parsed[1] !== 'string' ||
      !isCursorTimestamp(parsed[1]) ||
      typeof parsed[2] !== 'string' ||
      !UUID_PATTERN.test(parsed[2])
    ) {
      return undefined
    }
    return kind === 'match'
      ? { completedAt: parsed[1], matchId: parsed[2] }
      : { createdAt: parsed[1], accountId: parsed[2] }
  } catch {
    return undefined
  }
}

function normalizedQuery(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const query = value.trim().toLowerCase()
  if (
    query.length < 1 ||
    query.length > 64 ||
    (!UUID_PATTERN.test(query) && !USERNAME_PREFIX_PATTERN.test(query))
  ) {
    return null
  }
  return query
}

function matchSummaryResponse(match: AdminMatchSummary) {
  return {
    ...match,
    completedAt: new Date(match.completedAtMs).toISOString(),
    completedAtMs: undefined,
  }
}

function matchDetailResponse(match: AdminMatchDetail) {
  return {
    match: {
      ...matchSummaryResponse(match),
      schemaVersion: match.schemaVersion,
      config: match.config,
      boards: match.boards,
    },
  }
}

function accountResponse(account: AdminAccountSummary) {
  return {
    ...account,
    createdAt: new Date(account.createdAtMs).toISOString(),
    lastSeenAt:
      account.lastSeenAtMs === null
        ? null
        : new Date(account.lastSeenAtMs).toISOString(),
    createdAtMs: undefined,
    lastSeenAtMs: undefined,
  }
}

export function createAdminRouter(options: AdminRouterOptions) {
  const router = express.Router()
  const now = options.now ?? (() => new Date())

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.use(async (request, response, next) => {
    const token = readSessionToken(request.get('cookie'), options.secureCookie)
    if (!token) {
      sendError(
        response,
        401,
        'account_required',
        'Sign in with an administrator account.',
      )
      return
    }
    try {
      const user = await options.getSession(token)
      if (!user) {
        sendError(
          response,
          401,
          'account_required',
          'Sign in with an administrator account.',
        )
        return
      }
      if (user.role !== 'admin') {
        sendError(
          response,
          403,
          'admin_required',
          'Administrator access is required.',
        )
        return
      }
      next()
    } catch (error) {
      options.logger('error', 'admin.session_lookup_failed', {
        errorClass: errorClass(error),
      })
      sendError(
        response,
        503,
        'admin_unavailable',
        'The admin workspace is temporarily unavailable.',
      )
    }
  })

  router.get('/stats', async (_request, response) => {
    const capturedAt = now()
    try {
      const [runtime, storage] = await Promise.all([
        Promise.resolve(options.runtimeStats.getRuntimeStats()),
        options.repository.getStorageStats(capturedAt),
      ])
      response.status(200).json({
        capturedAt: capturedAt.toISOString(),
        runtime,
        storage,
      })
    } catch (error) {
      options.logger('error', 'admin.request_failed', {
        operation: 'stats',
        errorClass: errorClass(error),
      })
      sendError(
        response,
        503,
        'admin_unavailable',
        'Admin statistics are temporarily unavailable.',
      )
    }
  })

  router.get('/matches', async (request, response) => {
    const query = normalizedQuery(request.query.q)
    const cursorValue = request.query.cursor
    const cursor =
      cursorValue === undefined
        ? undefined
        : decodeCursor('match', cursorValue)
    if (query === null || (cursorValue !== undefined && !cursor)) {
      sendError(response, 400, 'invalid_input', 'Match filters are invalid.')
      return
    }
    try {
      const page = await options.repository.listMatches({
        limit: PAGE_SIZE,
        ...(query ? { query } : {}),
        ...(cursor ? { cursor } : {}),
      })
      response.status(200).json({
        items: page.items.map(matchSummaryResponse),
        nextCursor: page.nextCursor
          ? encodeCursor('match', page.nextCursor)
          : null,
      })
    } catch (error) {
      options.logger('error', 'admin.request_failed', {
        operation: 'matches',
        errorClass: errorClass(error),
      })
      sendError(
        response,
        503,
        'admin_unavailable',
        'Stored matches are temporarily unavailable.',
      )
    }
  })

  router.get('/matches/:matchId', async (request, response) => {
    const matchId = request.params.matchId
    if (typeof matchId !== 'string' || !UUID_PATTERN.test(matchId)) {
      sendError(response, 404, 'match_not_found', 'Stored match was not found.')
      return
    }
    try {
      const match = await options.repository.getMatch(matchId)
      if (!match) {
        sendError(response, 404, 'match_not_found', 'Stored match was not found.')
        return
      }
      response.status(200).json(matchDetailResponse(match))
    } catch (error) {
      options.logger('error', 'admin.request_failed', {
        operation: 'match_detail',
        errorClass: errorClass(error),
      })
      sendError(
        response,
        503,
        'admin_unavailable',
        'Stored match detail is temporarily unavailable.',
      )
    }
  })

  router.get('/accounts', async (request, response) => {
    const query = normalizedQuery(request.query.q)
    const cursorValue = request.query.cursor
    const cursor =
      cursorValue === undefined
        ? undefined
        : decodeCursor('account', cursorValue)
    if (query === null || (cursorValue !== undefined && !cursor)) {
      sendError(response, 400, 'invalid_input', 'Account filters are invalid.')
      return
    }
    try {
      const page = await options.repository.listAccounts({
        limit: PAGE_SIZE,
        ...(query ? { query } : {}),
        ...(cursor ? { cursor } : {}),
      })
      response.status(200).json({
        items: page.items.map(accountResponse),
        nextCursor: page.nextCursor
          ? encodeCursor('account', page.nextCursor)
          : null,
      })
    } catch (error) {
      options.logger('error', 'admin.request_failed', {
        operation: 'accounts',
        errorClass: errorClass(error),
      })
      sendError(
        response,
        503,
        'admin_unavailable',
        'Accounts are temporarily unavailable.',
      )
    }
  })

  return router
}
