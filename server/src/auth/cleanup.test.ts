import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { PostgresAuthCleanup } from './cleanup.js'

describe('PostgresAuthCleanup', () => {
  it('deletes expired sessions and rate limits older than the longest window', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 2 })
    const cleanup = new PostgresAuthCleanup({ query } as unknown as Pool, {
      now: () => new Date('2030-01-01T00:00:00.000Z'),
      longestRateLimitWindowSeconds: 3_600,
    })

    await expect(cleanup.deleteExpiredAuthState()).resolves.toEqual({
      sessions: 2,
      rateLimits: 2,
    })
    expect(query).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM auth_sessions WHERE expires_at <= $1',
      [new Date('2030-01-01T00:00:00.000Z')],
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM auth_rate_limits WHERE last_request <= $1',
      [expect.any(Number)],
    )
    const cutoff = query.mock.calls[1]?.[1]?.[0]
    // Better Auth 1.7.1 persists Date.now() milliseconds in last_request.
    expect(cutoff).toBe(1_893_452_400_000)
  })
})
