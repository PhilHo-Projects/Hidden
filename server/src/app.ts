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
import { GameHandler } from './gameHandler'
import { createLogger, type LogLevel } from './logger'

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024

export interface HiddenServerOptions {
  allowedOrigins: string[]
  authCleanupIntervalMs?: number
  authService?: AuthServiceLike
  heartbeatIntervalMs?: number
  host?: string
  logLevel?: LogLevel
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
  const logger = createLogger(options.logLevel ?? 'info')
  const httpServer: HttpServer = createServer(app)
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
  })
  const gameHandler = new GameHandler({
    logger,
    maxMessagesPerSecond: options.maxMessagesPerSecond ?? 30,
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
  let pendingUpgradeCount = 0

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
    void handleUpgrade(request, socket, head)
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

    if (
      gameHandler.connectionCount + pendingUpgradeCount >=
      maxConnections
    ) {
      logger('warn', 'upgrade.connection_limit', { maxConnections })
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }

    pendingUpgradeCount += 1
    try {
      const rawToken = readSessionToken(
        request.headers.cookie,
        secureCookie,
      )
      let identity: { accountId: string; username: string } | undefined
      if (rawToken) {
        if (!options.authService) {
          rejectUpgrade(socket, 503, 'Service Unavailable')
          return
        }
        try {
          const user = await options.authService.getSession(rawToken)
          if (user) {
            identity = { accountId: user.id, username: user.username }
          }
        } catch {
          logger('error', 'upgrade.session_lookup_failed')
          rejectUpgrade(socket, 503, 'Service Unavailable')
          return
        }
      }

      if (socket.destroyed) {
        return
      }
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        gameHandler.add(webSocket, identity)
      })
    } finally {
      pendingUpgradeCount -= 1
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

      closePromise = new Promise((resolve, reject) => {
        if (heartbeat) {
          clearInterval(heartbeat)
        }
        if (authCleanup) {
          clearInterval(authCleanup)
        }
        gameHandler.closeAll()

        const forceClose = setTimeout(() => {
          gameHandler.terminateAll()
          httpServer.closeAllConnections()
        }, shutdownGraceMs)
        forceClose.unref()

        webSocketServer.close()
        httpServer.close((error) => {
          clearTimeout(forceClose)
          if (error) {
            reject(error)
            return
          }
          logger('info', 'server.stopped')
          resolve()
        })
      })
      return closePromise
    },
  }
}
