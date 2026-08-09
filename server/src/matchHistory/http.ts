import express, { type NextFunction, type Request, type Response } from 'express'
import type { AuthenticatedUser } from '../auth/service'
import { readSessionToken } from '../auth/sessionToken'
import type { Logger } from '../logger'
import type {
  MatchHistoryCursor,
  MatchHistoryDetail,
  MatchHistoryRepository,
} from './repository'

const PAGE_SIZE = 20
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type HistoryErrorCode =
  | 'account_required'
  | 'invalid_input'
  | 'match_not_found'
  | 'history_unavailable'

interface MatchHistoryRouterOptions {
  readonly allowedOrigins: readonly string[]
  readonly getSession: (
    token: string | undefined,
  ) => Promise<AuthenticatedUser | undefined>
  readonly repository: Pick<
    MatchHistoryRepository,
    'listForAccount' | 'getForAccount' | 'setBookmarked'
  >
  readonly logger: Logger
  readonly secureCookie: boolean
}

function sendError(
  response: Response,
  status: number,
  code: HistoryErrorCode,
  message: string,
) {
  response.status(status).json({ error: { code, message } })
}

function errorClass(error: unknown) {
  return error instanceof Error ? error.name : typeof error
}

function encodeCursor(cursor: MatchHistoryCursor) {
  return Buffer.from(
    JSON.stringify([cursor.completedAtMs, cursor.matchId]),
    'utf8',
  ).toString('base64url')
}

function decodeCursor(value: unknown): MatchHistoryCursor | undefined {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    return undefined
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      !Number.isSafeInteger(decoded[0]) ||
      decoded[0] < 0 ||
      typeof decoded[1] !== 'string' ||
      !UUID_PATTERN.test(decoded[1])
    ) {
      return undefined
    }
    return { completedAtMs: decoded[0], matchId: decoded[1] }
  } catch {
    return undefined
  }
}

function detailResponse(detail: MatchHistoryDetail) {
  return {
    match: {
      matchId: detail.matchId,
      completedAt: new Date(detail.completedAtMs).toISOString(),
      engine: detail.engine,
      config: detail.config,
      turnCount: detail.turnCount,
      participants: detail.participants,
      result: detail.result,
      boards: detail.boards,
      viewerSeat: detail.viewerSeat,
      bookmarked: detail.bookmarked,
    },
  }
}

function currentUser(response: Response) {
  return response.locals.historyUser as AuthenticatedUser
}

export function createMatchHistoryRouter(options: MatchHistoryRouterOptions) {
  const router = express.Router()
  const json = express.json({ limit: 1_024, strict: true })

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.use(async (request, response, next) => {
    const token = readSessionToken(
      request.get('cookie'),
      options.secureCookie,
    )
    if (!token) {
      sendError(response, 401, 'account_required', 'Sign in to view match history.')
      return
    }
    try {
      const user = await options.getSession(token)
      if (!user) {
        sendError(
          response,
          401,
          'account_required',
          'Sign in to view match history.',
        )
        return
      }
      response.locals.historyUser = user
      next()
    } catch (error) {
      options.logger('error', 'match_history.session_lookup_failed', {
        errorClass: errorClass(error),
      })
      sendError(
        response,
        503,
        'history_unavailable',
        'Match history is temporarily unavailable.',
      )
    }
  })

  router.get('/', async (request, response) => {
    const bookmarkedValue = request.query.bookmarked
    if (
      bookmarkedValue !== undefined &&
      bookmarkedValue !== 'true' &&
      bookmarkedValue !== 'false'
    ) {
      sendError(response, 400, 'invalid_input', 'History filter is invalid.')
      return
    }
    const cursorValue = request.query.cursor
    const cursor = cursorValue === undefined ? undefined : decodeCursor(cursorValue)
    if (cursorValue !== undefined && !cursor) {
      sendError(response, 400, 'invalid_input', 'History cursor is invalid.')
      return
    }

    try {
      const page = await options.repository.listForAccount(
        currentUser(response).id,
        {
          limit: PAGE_SIZE,
          bookmarkedOnly: bookmarkedValue === 'true',
          ...(cursor ? { cursor } : {}),
        },
      )
      response.status(200).json({
        stats: page.stats,
        matches: page.matches.map((match) => ({
          ...match,
          completedAt: new Date(match.completedAtMs).toISOString(),
          completedAtMs: undefined,
        })),
        nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      })
    } catch (error) {
      options.logger('error', 'match_history.request_failed', {
        operation: 'list',
        errorClass: errorClass(error),
      })
      sendError(
        response,
        503,
        'history_unavailable',
        'Match history is temporarily unavailable.',
      )
    }
  })

  router.get('/:matchId', async (request, response) => {
    const matchId = request.params.matchId
    if (typeof matchId !== 'string' || !UUID_PATTERN.test(matchId)) {
      sendError(response, 404, 'match_not_found', 'Match history was not found.')
      return
    }
    try {
      const detail = await options.repository.getForAccount(
        currentUser(response).id,
        matchId,
      )
      if (!detail) {
        sendError(response, 404, 'match_not_found', 'Match history was not found.')
        return
      }
      response.status(200).json(detailResponse(detail))
    } catch (error) {
      options.logger('error', 'match_history.request_failed', {
        operation: 'detail',
        errorClass: errorClass(error),
      })
      sendError(
        response,
        503,
        'history_unavailable',
        'Match history is temporarily unavailable.',
      )
    }
  })

  function requireBookmarkJson(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    const origin = request.get('origin')
    if (!origin || !options.allowedOrigins.includes(origin)) {
      sendError(response, 403, 'invalid_input', 'Request origin is not allowed.')
      return
    }
    if (!request.is('application/json')) {
      sendError(response, 415, 'invalid_input', 'Request body must be JSON.')
      return
    }
    json(request, response, next)
  }

  router.put(
    '/:matchId/bookmark',
    requireBookmarkJson,
    async (request, response) => {
      const matchId = request.params.matchId
      const body = request.body as unknown
      if (
        typeof matchId !== 'string' ||
        !UUID_PATTERN.test(matchId) ||
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof (body as { bookmarked?: unknown }).bookmarked !== 'boolean'
      ) {
        sendError(response, 400, 'invalid_input', 'Bookmark request is invalid.')
        return
      }
      const bookmarked = (body as { bookmarked: boolean }).bookmarked
      try {
        const found = await options.repository.setBookmarked(
          currentUser(response).id,
          matchId,
          bookmarked,
        )
        if (!found) {
          sendError(
            response,
            404,
            'match_not_found',
            'Match history was not found.',
          )
          return
        }
        response.status(200).json({ bookmarked })
      } catch (error) {
        options.logger('error', 'match_history.request_failed', {
          operation: 'bookmark',
          errorClass: errorClass(error),
        })
        sendError(
          response,
          503,
          'history_unavailable',
          'Match history is temporarily unavailable.',
        )
      }
    },
  )

  router.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (
        error &&
        typeof error === 'object' &&
        'type' in error &&
        error.type === 'entity.too.large'
      ) {
        sendError(
          response,
          413,
          'invalid_input',
          'Bookmark request is too large.',
        )
        return
      }
      if (error instanceof SyntaxError) {
        sendError(response, 400, 'invalid_input', 'Bookmark request is invalid.')
        return
      }
      next(error)
    },
  )

  return router
}
