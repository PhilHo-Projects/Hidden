import { Pool } from 'pg'

interface DatabasePoolOptions {
  queryTimeoutMs?: number
}

export function createDatabasePool(
  connectionString: string,
  options: DatabasePoolOptions = {},
) {
  const queryTimeoutMs = options.queryTimeoutMs ?? 5_000
  return new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    query_timeout: queryTimeoutMs,
    statement_timeout: queryTimeoutMs,
  })
}
