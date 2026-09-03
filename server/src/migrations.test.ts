import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { assertMigrationsCurrent } from './migrations.js'

describe('database migration readiness', () => {
  it('accepts a database with the latest numbered migration applied', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { version: '001_accounts' },
          { version: '002_match_history' },
          { version: '003_admin_workbench_indexes' },
          { version: '004_user_last_seen' },
          { version: '005_better_auth' },
        ],
      }),
    } as unknown as Pool

    await expect(assertMigrationsCurrent(pool)).resolves.toBeUndefined()
  })

  it('fails closed without mutating an outdated database', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ version: '004_user_last_seen' }],
    })
    const pool = { query } as unknown as Pool

    await expect(assertMigrationsCurrent(pool)).rejects.toThrow(
      'Database schema is out of date',
    )
    expect(query).toHaveBeenCalledOnce()
    expect(String(query.mock.calls[0]?.[0])).toContain('schema_migrations')
  })
})
