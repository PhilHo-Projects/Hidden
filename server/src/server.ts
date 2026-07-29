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
import { resolveDatabaseUrl } from './serverConfig'

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ??
  'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

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

async function start() {
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
    authService = await AuthService.create(
      new PostgresAuthRepository(databasePool),
    )
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
  })
  await server.start()
}

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  writeRuntimeLog('info', 'server.shutdown_requested', { signal })
  try {
    await server?.close()
    await databasePool?.end()
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

void start().catch(async (error) => {
  writeRuntimeLog('error', 'server.start_failed', {
    error: error instanceof Error ? error.message : String(error),
  })
  await databasePool?.end().catch(() => undefined)
  process.exitCode = 1
})
