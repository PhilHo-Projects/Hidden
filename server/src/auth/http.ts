import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import type { Logger } from '../logger'
import { FixedWindowRateLimiter } from './rateLimiter'
import type { AuthUser } from './repository'
import {
  AuthServiceError,
  SESSION_DURATION_MS,
  type AuthSession,
} from './service'
import {
  clearSessionCookie,
  createSessionCookie,
  hasSessionCookie,
  readSessionToken,
} from './sessionToken'

export interface AuthServiceLike {
  register(value: unknown, previousRawToken?: string): Promise<AuthSession>
  login(value: unknown, previousRawToken?: string): Promise<AuthSession>
  getSession(rawToken: string | undefined): Promise<AuthUser | undefined>
  logout(rawToken: string | undefined): Promise<void>
  cleanupExpiredSessions(): Promise<number>
}

interface AuthRouterOptions {
  allowedOrigins: string[]
  authService?: AuthServiceLike
  logger: Logger
  secureCookie: boolean
}

interface ErrorBody {
  error: {
    code:
      | 'invalid_input'
      | 'username_taken'
      | 'invalid_credentials'
      | 'rate_limited'
      | 'account_service_unavailable'
    message: string
    field?: 'username' | 'password'
  }
}

function sendError(
  response: Response,
  status: number,
  error: ErrorBody['error'],
) {
  response.status(status).json({ error } satisfies ErrorBody)
}

function requestIp(request: Request) {
  return request.ip || request.socket.remoteAddress || 'unknown'
}

export function createAuthRouter(options: AuthRouterOptions) {
  const router = express.Router()
  const limiter = new FixedWindowRateLimiter()
  const json = express.json({ limit: 4 * 1_024, strict: true })

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  function requireAuthPost(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    const origin = request.get('origin')
    if (!origin || !options.allowedOrigins.includes(origin)) {
      sendError(response, 403, {
        code: 'invalid_input',
        message: 'Request origin is not allowed.',
      })
      return
    }
    if (!request.is('application/json')) {
      sendError(response, 415, {
        code: 'invalid_input',
        message: 'Request body must be JSON.',
      })
      return
    }
    json(request, response, next)
  }

  function sessionToken(request: Request) {
    return readSessionToken(request.get('cookie'), options.secureCookie)
  }

  function throttle(
    response: Response,
    checks: Array<{
      key: string
      limit: number
      windowMs: number
    }>,
  ) {
    for (const check of checks) {
      const result = limiter.consume(check.key, check.limit, check.windowMs)
      if (!result.allowed) {
        response.setHeader('Retry-After', result.retryAfterSeconds)
        sendError(response, 429, {
          code: 'rate_limited',
          message: 'Too many account attempts. Try again later.',
        })
        return true
      }
    }
    return false
  }

  async function createSessionResponse(
    request: Request,
    response: Response,
    operation: 'register' | 'login',
  ) {
    if (!options.authService) {
      sendError(response, 503, {
        code: 'account_service_unavailable',
        message: 'Accounts are temporarily unavailable.',
      })
      return
    }

    const ip = requestIp(request)
    if (
      operation === 'register' &&
      throttle(response, [
        {
          key: `register:${ip}`,
          limit: 5,
          windowMs: 60 * 60 * 1_000,
        },
      ])
    ) {
      return
    }
    if (operation === 'login') {
      const body =
        request.body && typeof request.body === 'object'
          ? (request.body as Record<string, unknown>)
          : {}
      const usernameKey =
        typeof body.username === 'string'
          ? body.username.trim().toLowerCase()
          : '<invalid>'
      if (
        throttle(response, [
          {
            key: `login-ip:${ip}`,
            limit: 30,
            windowMs: 15 * 60 * 1_000,
          },
          {
            key: `login-user:${ip}:${usernameKey}`,
            limit: 10,
            windowMs: 15 * 60 * 1_000,
          },
        ])
      ) {
        return
      }
    }

    try {
      const authSession = await options.authService[operation](
        request.body,
        sessionToken(request),
      )
      response.setHeader(
        'Set-Cookie',
        createSessionCookie(
          authSession.rawToken,
          options.secureCookie,
          SESSION_DURATION_MS / 1_000,
        ),
      )
      options.logger(
        'info',
        operation === 'register'
          ? 'auth.registered'
          : 'auth.login_succeeded',
        { userId: authSession.user.id },
      )
      response.status(operation === 'register' ? 201 : 200).json({
        user: authSession.user,
      })
    } catch (error) {
      if (error instanceof AuthServiceError) {
        options.logger('warn', `auth.${operation}_rejected`, {
          code: error.code,
        })
        const status =
          error.code === 'username_taken'
            ? 409
            : error.code === 'invalid_credentials'
              ? 401
              : 400
        sendError(response, status, {
          code: error.code,
          message: error.message,
          ...(error.field ? { field: error.field } : {}),
        })
        return
      }

      options.logger('error', 'auth.request_failed', { operation })
      sendError(response, 503, {
        code: 'account_service_unavailable',
        message: 'Accounts are temporarily unavailable.',
      })
    }
  }

  router.get('/session', async (request, response) => {
    const cookieHeader = request.get('cookie')
    const token = readSessionToken(cookieHeader, options.secureCookie)
    if (!options.authService) {
      sendError(response, 503, {
        code: 'account_service_unavailable',
        message: 'Accounts are temporarily unavailable.',
      })
      return
    }
    if (!token) {
      if (hasSessionCookie(cookieHeader, options.secureCookie)) {
        response.setHeader(
          'Set-Cookie',
          clearSessionCookie(options.secureCookie),
        )
      }
      response.status(200).json({ user: null })
      return
    }

    try {
      const user = await options.authService.getSession(token)
      if (!user) {
        response.setHeader(
          'Set-Cookie',
          clearSessionCookie(options.secureCookie),
        )
      }
      response.status(200).json({ user: user ?? null })
    } catch {
      options.logger('error', 'auth.session_lookup_failed')
      sendError(response, 503, {
        code: 'account_service_unavailable',
        message: 'Accounts are temporarily unavailable.',
      })
    }
  })

  router.post('/register', requireAuthPost, (request, response) => {
    void createSessionResponse(request, response, 'register')
  })
  router.post('/login', requireAuthPost, (request, response) => {
    void createSessionResponse(request, response, 'login')
  })
  router.post('/logout', requireAuthPost, async (request, response) => {
    if (!options.authService) {
      sendError(response, 503, {
        code: 'account_service_unavailable',
        message: 'Accounts are temporarily unavailable.',
      })
      return
    }
    try {
      await options.authService.logout(sessionToken(request))
      options.logger('info', 'auth.logout_succeeded')
      response.setHeader(
        'Set-Cookie',
        clearSessionCookie(options.secureCookie),
      )
      response.status(204).end()
    } catch {
      options.logger('error', 'auth.logout_failed')
      sendError(response, 503, {
        code: 'account_service_unavailable',
        message: 'Accounts are temporarily unavailable.',
      })
    }
  })

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
        sendError(response, 413, {
          code: 'invalid_input',
          message: 'Request body is too large.',
        })
        return
      }
      if (error instanceof SyntaxError) {
        sendError(response, 400, {
          code: 'invalid_input',
          message: 'Request body is not valid JSON.',
        })
        return
      }
      next(error)
    },
  )

  return router
}
