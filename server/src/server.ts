import path from 'node:path'
import type { Pool } from 'pg'
import { AuthService } from './auth/service'
import { PostgresAuthRepository } from './auth/repository'
import {
  createHiddenServer,
  type HiddenServer,
} from './app'
import { createDatabasePool } from './database'
import { type LogLevel } from './logger'
import { runMigrations } from './migrations'
import { RuntimeLifecycle } from './runtimeLifecycle'
import {
  resolveAllowedOrigins,
  resolveDatabaseUrl,
} from './serverConfig'

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
  const allowedOrigins = resolveAllowedOrigins(
    process.env.NODE_ENV,
    process.env.ALLOWED_ORIGINS,
  )
  const databaseUrl = resolveDatabaseUrl(
    process.env.NODE_ENV,
    process.env.DATABASE_URL,
  )
  let authService: AuthService | undefined
  if (databaseUrl) {
    databasePool = createDatabasePool(databaseUrl)
    databasePool.on('error', (error) => {
      writeRuntimeLog('error', 'database.pool_error', {
        error: error.message,
      })
    })
    await runMigrations(databasePool)
    if (isStopping()) {
      return
    }
    authService = await AuthService.create(
      new PostgresAuthRepository(databasePool),
    )
    if (isStopping()) {
      return
    }
  } else {
    writeRuntimeLog('warn', 'auth.disabled_guest_only')
  }

  server = createHiddenServer({
    allowedOrigins,
    ...(authService ? { authService } : {}),
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
    trustProxy:
      process.env.NODE_ENV === 'production'
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
