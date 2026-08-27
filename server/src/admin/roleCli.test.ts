import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { runRoleCli } from './roleCli.js'

describe('admin role CLI', () => {
  it('accepts the documented user and role flags without passwords', async () => {
    const setRole = vi.fn().mockResolvedValue({ role: 'admin' })
    const write = vi.fn()
    const pool = { end: vi.fn() } as unknown as Pool

    await runRoleCli(['--user', 'Player_ONE', '--role', 'admin'], {
      databaseUrl: 'postgresql://test',
      createPool: () => pool,
      migrate: vi.fn(),
      setRole,
      write,
    })

    expect(setRole).toHaveBeenCalledWith(pool, {
      identifier: 'Player_ONE',
      role: 'admin',
    })
    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({ event: 'admin.role_updated', role: 'admin' })}\n`,
    )
    expect(pool.end).toHaveBeenCalled()
  })

  it.each([
    { args: [] },
    { args: ['--user', 'player'] },
    { args: ['--role', 'admin'] },
    { args: ['--user', 'player', '--role', 'owner'] },
    { args: ['--user', 'player', '--role', 'admin', '--password', 'secret'] },
  ])('rejects malformed arguments without opening a database', async ({ args }) => {
    const createPool = vi.fn()
    await expect(
      runRoleCli(args, {
        databaseUrl: 'postgresql://test',
        createPool,
        migrate: vi.fn(),
        setRole: vi.fn(),
        write: vi.fn(),
      }),
    ).rejects.toThrow('Usage:')
    expect(createPool).not.toHaveBeenCalled()
  })
})
