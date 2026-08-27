import path from 'node:path'
import type { Pool } from 'pg'
import { PostgresAdminRepository } from './admin/postgresRepository.js'
import { resolveAuthConfig } from './auth/authConfig.js'
import { createHiddenAuth } from './auth/betterAuth.js'
import { PostgresAuthCleanup } from './auth/cleanup.js'
import { ResendTransactionalEmail } from './auth/email.js'
import { createBoundedAuthHandler } from './auth/nodeHandler.js'
import { createSessionResolver } from './auth/sessionResolver.js'
import {
  createHiddenServer,
  type HiddenServer,
} from './app.js'
import { createDatabasePool } from './database.js'
import { type LogLevel } from './logger.js'
import { assertMigrationsCurrent } from './migrations.js'
import { PostgresMatchHistoryRepository } from './matchHistory/repository.js'
import { RuntimeLifecycle } from './runtimeLifecycle.js'
import {
  resolveAllowedOrigins,
} from './serverConfig.js'

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

let server: HiddenServer | undefined
let databasePool: Pool | undefined
let shuttingDown = false

function writeRuntimeLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown> = {},
) {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  })
  if (level === 'error') {
    console.error(output)
  } else if (level === 'warn') {
    console.warn(output)
  } else {
    console.log(output)
  }
}

async function start(isStopping: () => boolean) {
  const authConfig = resolveAuthConfig(process.env)
  const allowedOrigins = authConfig.enabled
    ? authConfig.allowedOrigins
    : resolveAllowedOrigins(process.env.NODE_ENV, process.env.ALLOWED_ORIGINS)
  let auth:
    | NonNullable<Parameters<typeof createHiddenServer>[0]['auth']>
    | undefined
  let authCleanup: PostgresAuthCleanup | undefined
  let adminRepository: PostgresAdminRepository | undefined
  let matchHistoryRepository: PostgresMatchHistoryRepository | undefined
  if (authConfig.enabled) {
    databasePool = createDatabasePool(authConfig.databaseUrl)
    databasePool.on('error', (error) => {
      writeRuntimeLog('error', 'database.pool_error', {
        error: error.message,
      })
    })
    await assertMigrationsCurrent(databasePool)
    if (isStopping()) {
      return
    }
    const hiddenAuth = createHiddenAuth({
      pool: databasePool,
      config: authConfig,
      emails: new ResendTransactionalEmail({
        apiKey: authConfig.resendApiKey,
        from: authConfig.emailFrom,
      }),
    })
    auth = {
      handler: createBoundedAuthHandler({
        auth: hiddenAuth,
        baseURL: authConfig.baseURL,
      }),
      sessions: createSessionResolver(hiddenAuth.api, {
        cookieName: authConfig.production
          ? '__Host-hidden_session'
          : 'hidden_session',
      }),
    }
    authCleanup = new PostgresAuthCleanup(databasePool)
    adminRepository = new PostgresAdminRepository(databasePool)
    matchHistoryRepository = new PostgresMatchHistoryRepository(databasePool)
    if (isStopping()) {
      return
    }
  } else {
    writeRuntimeLog('warn', 'auth.disabled_guest_only')
  }

  server = createHiddenServer({
    allowedOrigins,
    ...(adminRepository ? { adminRepository } : {}),
    ...(auth ? { auth } : {}),
    ...(authCleanup ? { authCleanup } : {}),
    ...(matchHistoryRepository ? { matchHistoryRepository } : {}),
    authRevalidationIntervalMs: parsePositiveInteger(
      process.env.AUTH_REVALIDATION_INTERVAL_MS,
      300_000,
    ),
    heartbeatIntervalMs: parsePositiveInteger(
      process.env.HEARTBEAT_INTERVAL_MS,
      30_000,
    ),
    logLevel: (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
    maxConnections: parsePositiveInteger(process.env.MAX_CONNECTIONS, 100),
    maxMessagesPerSecond: parsePositiveInteger(
      process.env.MAX_MESSAGES_PER_SECOND,
      30,
    ),
    maxPayloadBytes: parsePositiveInteger(
      process.env.MAX_PAYLOAD_BYTES,
      16 * 1024,
    ),
    port: parsePositiveInteger(process.env.PORT, 8080),
    staticRoot: process.env.STATIC_ROOT ?? path.resolve(process.cwd(), 'public'),
    trustProxy: authConfig.enabled
      ? authConfig.trustProxyHops
      : process.env.NODE_ENV === 'production'
        ? parsePositiveInteger(process.env.TRUST_PROXY_HOPS, 1)
        : process.env.TRUST_PROXY_HOPS
          ? parsePositiveInteger(process.env.TRUST_PROXY_HOPS, 1)
          : false,
  })
  await server.start()
}

async function stop() {
  await server?.close()
  await databasePool?.end()
}

const lifecycle = new RuntimeLifecycle(start, stop)

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  writeRuntimeLog('info', 'server.shutdown_requested', { signal })
  try {
    await lifecycle.stop()
    process.exitCode = 0
  } catch (error) {
    writeRuntimeLog('error', 'server.shutdown_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  }
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.once('SIGINT', () => {
  void shutdown('SIGINT')
})

void lifecycle.start().catch(async (error) => {
  writeRuntimeLog('error', 'server.start_failed', {
    error: error instanceof Error ? error.message : String(error),
  })
  await lifecycle.stop().catch(() => undefined)
  process.exitCode = 1
})
