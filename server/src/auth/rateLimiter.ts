interface WindowEntry {
  count: number
  expiresAt: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>()

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): RateLimitResult {
    const existing = this.entries.get(key)
    const entry =
      !existing || existing.expiresAt <= now
        ? { count: 0, expiresAt: now + windowMs }
        : existing

    if (entry.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((entry.expiresAt - now) / 1_000),
        ),
      }
    }

    entry.count += 1
    this.entries.set(key, entry)
    return { allowed: true, retryAfterSeconds: 0 }
  }
}
