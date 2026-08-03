import express from 'express'
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
} from 'node:http'
import path from 'node:path'
import { type Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import {
  createAuthRouter,
  type AuthServiceLike,
} from './auth/http'
import { readSessionToken } from './auth/sessionToken'
import { GameHandler, type ClientIdentity } from './gameHandler'
import { createLogger, type Logger, type LogLevel } from './logger'
import type { MatchCoordinator } from './matchCoordinator'

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024

export interface HiddenServerOptions {
  allowedOrigins: string[]
  authCleanupIntervalMs?: number
  authService?: AuthServiceLike
  heartbeatIntervalMs?: number
  host?: string
  logLevel?: LogLevel
  logger?: Logger
  matchCoordinator?: MatchCoordinator
  maxConnections?: number
  maxMessagesPerSecond?: number
  maxPayloadBytes?: number
  port?: number
  shutdownGraceMs?: number
  sessionCookieSecure?: boolean
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

export function createHiddenServer(options: HiddenServerOptions): HiddenServer {
  const app = express()
  const logger = options.logger ?? createLogger(options.logLevel ?? 'info')
  const httpServer: HttpServer = createServer(app)
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
  })
  const gameHandler = new GameHandler({
    logger,
    maxMessagesPerSecond: options.maxMessagesPerSecond ?? 30,
    ...(options.matchCoordinator
      ? { matchCoordinator: options.matchCoordinator }
      : {}),
  })
  const host = options.host ?? '0.0.0.0'
  const maxConnections = options.maxConnections ?? 100
  const port = options.port ?? 8080
  const shutdownGraceMs = options.shutdownGraceMs ?? 5_000
  const secureCookie =
    options.sessionCookieSecure ?? process.env.NODE_ENV === 'production'
  let heartbeat: NodeJS.Timeout | undefined
  let authCleanup: NodeJS.Timeout | undefined
  let closePromise: Promise<void> | undefined
  let closing = false
  const pendingUpgradeSockets = new Set<Duplex>()
  const pendingUpgradeTasks = new Set<Promise<void>>()

  app.disable('x-powered-by')
  if (options.trustProxy !== undefined) {
    app.set('trust proxy', options.trustProxy)
  }
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })
  app.use(
    '/api/auth',
    createAuthRouter({
      allowedOrigins: options.allowedOrigins,
      ...(options.authService ? { authService: options.authService } : {}),
      logger,
      secureCookie,
    }),
  )
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

    const rawToken = readSessionToken(
      request.headers.cookie,
      secureCookie,
    )
    if (!rawToken) {
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

    if (!options.authService) {
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
      const user = await options.authService.getSession(rawToken)
      if (user) {
        identity = {
          accountId: user.id,
          role: user.role,
          username: user.username,
        }
      }
    } catch {
      logger('error', 'upgrade.session_lookup_failed')
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
    for (const socket of pendingUpgradeSockets) {
      socket.destroy()
    }
    gameHandler.closeAll()

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
  if (options.authService && authCleanupIntervalMs > 0) {
    authCleanup = setInterval(() => {
      void options.authService
        ?.cleanupExpiredSessions()
        .catch(() => logger('error', 'auth.session_cleanup_failed'))
    }, authCleanupIntervalMs)
    authCleanup.unref()
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
