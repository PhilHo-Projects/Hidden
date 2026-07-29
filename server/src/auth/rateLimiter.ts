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

  get entryCount() {
    return this.entries.size
  }

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): RateLimitResult {
    if (this.entries.size >= 256 && now >= this.nextCleanupAt) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.expiresAt <= now) {
          this.entries.delete(entryKey)
        }
      }
      this.nextCleanupAt = now + Math.min(windowMs, 60_000)
    }

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
