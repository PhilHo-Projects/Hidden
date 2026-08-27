import express from 'express'
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import path from 'node:path'
import { type Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { createAdminRouter } from './admin/http.js'
import type { AdminRepository } from './admin/repository.js'
import type { AuthCleanup } from './auth/cleanup.js'
import type {
  PublicSessionIdentity,
  PublicSessionResolver,
} from './auth/sessionResolver.js'
import { GameHandler, type ClientIdentity } from './gameHandler.js'
import { createLogger, type Logger, type LogLevel } from './logger.js'
import { MatchCoordinator } from './matchCoordinator.js'
import { createMatchHistoryRouter } from './matchHistory/http.js'
import { MatchHistoryRecorder } from './matchHistory/recorder.js'
import type { MatchHistoryRepository } from './matchHistory/repository.js'

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024

export interface HiddenServerOptions {
  adminRepository?: AdminRepository
  allowedOrigins: string[]
  auth?: {
    handler(request: IncomingMessage, response: ServerResponse): Promise<void>
    sessions: PublicSessionResolver
  }
  authCleanup?: AuthCleanup
  authCleanupIntervalMs?: number
  authRevalidationIntervalMs?: number
  heartbeatIntervalMs?: number
  host?: string
  logLevel?: LogLevel
  logger?: Logger
  matchCoordinator?: MatchCoordinator
  matchHistoryRepository?: MatchHistoryRepository
  maxConnections?: number
  maxMessagesPerSecond?: number
  maxPayloadBytes?: number
  port?: number
  shutdownGraceMs?: number
  staticRoot: string
  trustProxy?: boolean | number
}

export interface HiddenServer {
  start(): Promise<{ port: number }>
  close(): Promise<void>
}

function rejectUpgrade(socket: Duplex, status: number, label: string) {
  socket.end(
    `HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  )
}

function errorClass(error: unknown) {
  return error instanceof Error ? error.name : typeof error
}

export function createHiddenServer(options: HiddenServerOptions): HiddenServer {
  const app = express()
  const logger = options.logger ?? createLogger(options.logLevel ?? 'info')
  const httpServer: HttpServer = createServer(app)
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
  })
  const matchHistoryRecorder = options.matchHistoryRepository
    ? new MatchHistoryRecorder(options.matchHistoryRepository, logger)
    : undefined
  const matchCoordinator =
    options.matchCoordinator ??
    new MatchCoordinator({
      ...(matchHistoryRecorder
        ? {
            onMatchCompleted: (record) =>
              matchHistoryRecorder.record(record),
          }
        : {}),
    })
  const gameHandler = new GameHandler({
    logger,
    maxMessagesPerSecond: options.maxMessagesPerSecond ?? 30,
    matchCoordinator,
  })
  const host = options.host ?? '0.0.0.0'
  const maxConnections = options.maxConnections ?? 100
  const port = options.port ?? 8080
  const shutdownGraceMs = options.shutdownGraceMs ?? 5_000
  let heartbeat: NodeJS.Timeout | undefined
  let authCleanup: NodeJS.Timeout | undefined
  let authRevalidation: NodeJS.Timeout | undefined
  let revalidationRunning = false
  let closePromise: Promise<void> | undefined
  let closing = false
  const pendingUpgradeSockets = new Set<Duplex>()
  const pendingUpgradeTasks = new Set<Promise<void>>()
  const authenticatedSockets = new Map<WebSocket, Headers>()

  app.disable('x-powered-by')
  if (options.trustProxy !== undefined) {
    app.set('trust proxy', options.trustProxy)
  }
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })
  app.all('/api/auth/*splat', (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (!options.auth) {
      response.status(503).json({
        error: {
          code: 'account_service_unavailable',
          message: 'Account service is unavailable.',
        },
      })
      return
    }
    void options.auth.handler(request, response).catch((error) => {
      logger('error', 'auth.request_failed', { errorClass: errorClass(error) })
      if (!response.headersSent) {
        response.status(503).json({
          error: {
            code: 'account_service_unavailable',
            message: 'Account service is unavailable.',
          },
        })
      } else {
        response.destroy()
      }
    })
  })
  if (options.auth && options.adminRepository) {
    app.use(
      '/api/admin',
      createAdminRouter({
        sessions: options.auth.sessions,
        repository: options.adminRepository,
        runtimeStats: gameHandler,
        logger,
      }),
    )
  }
  if (options.auth && options.matchHistoryRepository) {
    app.use(
      '/api/history',
      createMatchHistoryRouter({
        allowedOrigins: options.allowedOrigins,
        sessions: options.auth.sessions,
        repository: options.matchHistoryRepository,
        logger,
      }),
    )
  }
  app.use(express.static(options.staticRoot, { index: false }))
  app.use((request, response, next) => {
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.accepts('html')
    ) {
      response.sendFile(path.join(options.staticRoot, 'index.html'))
      return
    }
    next()
  })

  httpServer.on('upgrade', (request, socket, head) => {
    if (closing) {
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    const task = handleUpgrade(request, socket, head).catch(() => {
      logger('error', 'upgrade.unexpected_failure')
      socket.destroy()
    })
    pendingUpgradeTasks.add(task)
    void task.finally(() => pendingUpgradeTasks.delete(task))
  })

  async function handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname !== '/ws') {
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }

    const origin = request.headers.origin
    if (!origin || !options.allowedOrigins.includes(origin)) {
      logger('warn', 'upgrade.rejected_origin', { origin: origin ?? null })
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }

    const hasSessionCookie = options.auth?.sessions.hasSessionCookie(
      request.headers,
    ) ?? /(?:^|;\s*)(?:__Host-hidden_session|hidden_session)=/.test(
      request.headers.cookie ?? '',
    )
    if (!hasSessionCookie) {
      if (gameHandler.connectionCount >= maxConnections) {
        logger('warn', 'upgrade.connection_limit', { maxConnections })
        rejectUpgrade(socket, 503, 'Service Unavailable')
        return
      }
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        gameHandler.add(webSocket)
      })
      return
    }

    if (!options.auth) {
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    if (
      gameHandler.connectionCount + pendingUpgradeSockets.size >=
      maxConnections
    ) {
      logger('warn', 'upgrade.connection_limit', { maxConnections })
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }

    pendingUpgradeSockets.add(socket)
    let identity: ClientIdentity | undefined
    try {
      const user = await options.auth.sessions.resolve(request.headers)
      if (user) {
        identity = {
          accountId: user.id,
          role: user.role,
          username: user.username,
        }
      } else {
        rejectUpgrade(socket, 401, 'Unauthorized')
        return
      }
    } catch (error) {
      logger('error', 'upgrade.session_lookup_failed', {
        errorClass: errorClass(error),
      })
      if (!socket.destroyed) {
        rejectUpgrade(socket, 503, 'Service Unavailable')
      }
      return
    } finally {
      pendingUpgradeSockets.delete(socket)
    }

    if (closing || socket.destroyed) {
      socket.destroy()
      return
    }
    if (gameHandler.connectionCount >= maxConnections) {
      logger('warn', 'upgrade.connection_limit', { maxConnections })
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      if (closing) {
        webSocket.close(1012, 'Server restarting')
        return
      }
      gameHandler.add(webSocket, identity)
      if (identity) {
        const headers = new Headers()
        if (request.headers.cookie) {
          headers.set('cookie', request.headers.cookie)
        }
        authenticatedSockets.set(webSocket, headers)
        webSocket.once('close', () => authenticatedSockets.delete(webSocket))
      }
    })
  }

  async function waitForPendingUpgrades() {
    if (pendingUpgradeTasks.size === 0) {
      return
    }
    let timeout: NodeJS.Timeout | undefined
    const graceExpired = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, shutdownGraceMs)
    })
    await Promise.race([
      Promise.allSettled([...pendingUpgradeTasks]).then(() => undefined),
      graceExpired,
    ])
    if (timeout) {
      clearTimeout(timeout)
    }
  }

  async function closeServer() {
    closing = true
    if (heartbeat) {
      clearInterval(heartbeat)
    }
    if (authCleanup) {
      clearInterval(authCleanup)
    }
    if (authRevalidation) {
      clearInterval(authRevalidation)
    }
    for (const socket of pendingUpgradeSockets) {
      socket.destroy()
    }
    gameHandler.closeAll()
    authenticatedSockets.clear()

    const forceClose = setTimeout(() => {
      for (const socket of pendingUpgradeSockets) {
        socket.destroy()
      }
      gameHandler.terminateAll()
      httpServer.closeAllConnections()
    }, shutdownGraceMs)
    forceClose.unref()

    const webSocketsClosed = new Promise<void>((resolve, reject) => {
      webSocketServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    const httpClosed = new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

    try {
      await Promise.all([
        httpClosed,
        webSocketsClosed,
        waitForPendingUpgrades(),
      ])
      await matchHistoryRecorder?.flush()
      logger('info', 'server.stopped')
    } finally {
      clearTimeout(forceClose)
    }
  }

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000
  if (heartbeatIntervalMs > 0) {
    heartbeat = setInterval(() => {
      gameHandler.heartbeat()
    }, heartbeatIntervalMs)
    heartbeat.unref()
  }

  const authCleanupIntervalMs =
    options.authCleanupIntervalMs ?? 6 * 60 * 60 * 1_000
  if (options.authCleanup && authCleanupIntervalMs > 0) {
    authCleanup = setInterval(() => {
      void options.authCleanup
        ?.deleteExpiredAuthState()
        .catch((error) =>
          logger('error', 'auth.cleanup_failed', {
            errorClass: errorClass(error),
          }),
        )
    }, authCleanupIntervalMs)
    authCleanup.unref()
  }

  const authRevalidationIntervalMs =
    options.authRevalidationIntervalMs ?? 300_000
  if (options.auth && authRevalidationIntervalMs > 0) {
    authRevalidation = setInterval(() => {
      if (revalidationRunning) return
      revalidationRunning = true
      void (async () => {
        if (closing) return
        await Promise.all(
          [...authenticatedSockets].map(async ([socket, headers]) => {
            if (socket.readyState !== WebSocket.OPEN) return
            let refreshed: PublicSessionIdentity | undefined
            try {
              refreshed = await options.auth!.sessions.resolve(headers)
            } catch (error) {
              logger('error', 'auth.websocket_revalidation_failed', {
                errorClass: errorClass(error),
              })
              socket.close(1011, 'Authentication unavailable')
              return
            }
            if (closing || socket.readyState !== WebSocket.OPEN) return
            if (!refreshed) {
              socket.close(4001, 'Authentication expired')
              return
            }
            const accepted = gameHandler.refreshAuthenticatedIdentity(
              socket,
              {
                accountId: refreshed.id,
                role: refreshed.role,
                username: refreshed.username,
              },
            )
            if (!accepted) {
              socket.close(4002, 'Authentication changed')
            }
          }),
        )
      })().finally(() => {
        revalidationRunning = false
      })
    }, authRevalidationIntervalMs)
    authRevalidation.unref()
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => {
          httpServer.off('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          httpServer.off('error', onError)
          const address = httpServer.address()
          if (!address || typeof address === 'string') {
            reject(new Error('Server did not bind to a TCP port.'))
            return
          }
          logger('info', 'server.started', {
            host,
            port: address.port,
            maxConnections,
          })
          resolve({ port: address.port })
        }
        httpServer.once('error', onError)
        httpServer.once('listening', onListening)
        httpServer.listen(port, host)
      })
    },
    close() {
      if (closePromise) {
        return closePromise
      }
      closePromise = closeServer()
      return closePromise
    },
  }
}
