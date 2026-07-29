import { Pool } from 'pg'

export function createDatabasePool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  })
}
