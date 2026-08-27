import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import {
  AdminRoleError,
  setAdminRole,
} from './role.js'

describe('setAdminRole', () => {
  it.each(['admin', 'player'] as const)(
    'sets only the server-owned role to %s for a verified account',
    async (role) => {
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'user-id', email_verified: true }] })
        .mockResolvedValueOnce({ rowCount: 1 })
      const pool = { query } as unknown as Pool

      await expect(
        setAdminRole(pool, { identifier: ' Player_ONE ', role }),
      ).resolves.toEqual({ role })
      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('lower(email) = $1'),
        ['player_one'],
      )
      expect(query).toHaveBeenNthCalledWith(
        2,
        'UPDATE users SET role = $2 WHERE id = $1',
        ['user-id', role],
      )
      expect(JSON.stringify(query.mock.calls)).not.toContain('password')
    },
  )

  it.each([
    [[], 'account_not_found' as const],
    [[{ id: 'user-id', email_verified: false }], 'email_not_verified' as const],
  ])('refuses missing and unverified accounts', async (rows, code) => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows }),
    } as unknown as Pool
    await expect(
      setAdminRole(pool, { identifier: 'player@example.test', role: 'admin' }),
    ).rejects.toEqual(expect.objectContaining<Partial<AdminRoleError>>({ code }))
  })

  it('accepts exactly the two database roles', async () => {
    const pool = { query: vi.fn() } as unknown as Pool
    await expect(
      setAdminRole(pool, { identifier: 'player', role: 'owner' as 'admin' }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AdminRoleError>>({ code: 'invalid_role' }),
    )
    expect(pool.query).not.toHaveBeenCalled()
  })
})
