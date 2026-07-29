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
  private nextCleanupAt = 0

  constructor(private readonly maxEntries = 10_000) {}

  get entryCount() {
    return this.entries.size
  }

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): RateLimitResult {
    const cleanupThreshold = Math.min(256, this.maxEntries)
    if (
      this.entries.size >= cleanupThreshold &&
      now >= this.nextCleanupAt
    ) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.expiresAt <= now) {
          this.entries.delete(entryKey)
        }
      }
      this.nextCleanupAt = now + Math.min(windowMs, 60_000)
    }

    const existing = this.entries.get(key)
    if (!existing && this.entries.size >= this.maxEntries) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(Math.min(windowMs, 60_000) / 1_000),
        ),
      }
    }
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
