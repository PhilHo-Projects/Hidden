import path from 'node:path'
import { createHiddenServer } from './app'
import { type LogLevel } from './logger'

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

const server = createHiddenServer({
  allowedOrigins,
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

let shuttingDown = false
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'server.shutdown_requested',
      signal,
    }),
  )
  try {
    await server.close()
    process.exitCode = 0
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'server.shutdown_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    process.exitCode = 1
  }
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.once('SIGINT', () => {
  void shutdown('SIGINT')
})

void server.start().catch((error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'server.start_failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  process.exitCode = 1
})
