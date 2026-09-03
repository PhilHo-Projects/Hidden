import type { Pool } from 'pg'

export interface AuthCleanup {
  deleteExpiredAuthState(): Promise<{
    sessions: number
    rateLimits: number
  }>
}

export class PostgresAuthCleanup implements AuthCleanup {
  private readonly now: () => Date
  private readonly longestRateLimitWindowSeconds: number

  constructor(
    private readonly pool: Pool,
    options: {
      now?: () => Date
      longestRateLimitWindowSeconds?: number
    } = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.longestRateLimitWindowSeconds =
      options.longestRateLimitWindowSeconds ?? 3_600
  }

  async deleteExpiredAuthState() {
    const now = this.now()
    const sessions = await this.pool.query(
      'DELETE FROM auth_sessions WHERE expires_at <= $1',
      [now],
    )
    // Better Auth 1.7.1 writes Date.now() milliseconds to last_request.
    const rateLimitCutoff =
      now.getTime() - this.longestRateLimitWindowSeconds * 1_000
    const rateLimits = await this.pool.query(
      'DELETE FROM auth_rate_limits WHERE last_request <= $1',
      [rateLimitCutoff],
    )
    return {
      sessions: sessions.rowCount ?? 0,
      rateLimits: rateLimits.rowCount ?? 0,
    }
  }
}
