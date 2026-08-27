import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { runMigrationCli } from './migrateCli.js'

describe('database migration CLI', () => {
  it('runs migrations only through the explicit command and closes the pool', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined)
    const write = vi.fn()
    const pool = { end: vi.fn() } as unknown as Pool

    await runMigrationCli([], {
      databaseUrl: 'postgresql://test',
      createPool: () => pool,
      migrate,
      write,
    })

    expect(migrate).toHaveBeenCalledOnce()
    expect(migrate).toHaveBeenCalledWith(pool)
    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({ event: 'database.migrations_applied' })}\n`,
    )
    expect(pool.end).toHaveBeenCalledOnce()
  })

  it('rejects arguments and missing configuration before opening a pool', async () => {
    const createPool = vi.fn()
    const dependencies = {
      databaseUrl: 'postgresql://test',
      createPool,
      migrate: vi.fn(),
      write: vi.fn(),
    }

    await expect(runMigrationCli(['unexpected'], dependencies)).rejects.toThrow(
      'Usage:',
    )
    await expect(
      runMigrationCli([], { ...dependencies, databaseUrl: undefined }),
    ).rejects.toThrow('DATABASE_URL is required.')
    expect(createPool).not.toHaveBeenCalled()
  })
})
