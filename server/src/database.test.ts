import { describe, expect, it } from 'vitest'
import { createDatabasePool } from './database'

const databaseUrl = process.env.TEST_DATABASE_URL
const itDatabase = databaseUrl ? it : it.skip

describe('database pool', () => {
  it('bounds both client-side query waits and PostgreSQL statements', async () => {
    const pool = createDatabasePool(
      'postgresql://hidden:secret@127.0.0.1:5432/hidden',
    )

    expect(pool.options.max).toBe(10)
    expect(pool.options.connectionTimeoutMillis).toBe(5_000)
    expect(pool.options.query_timeout).toBe(5_000)
    expect(pool.options.statement_timeout).toBe(5_000)

    await pool.end()
  })

  itDatabase('interrupts a statement that exceeds the query deadline', async () => {
    const pool = createDatabasePool(databaseUrl!, {
      queryTimeoutMs: 25,
    })
    try {
      await expect(
        pool.query('SELECT pg_sleep(0.2)'),
      ).rejects.toBeDefined()
    } finally {
      await pool.end()
    }
  })
})
