import { describe, expect, it } from 'vitest'
import { FixedWindowRateLimiter } from './rateLimiter'

describe('FixedWindowRateLimiter', () => {
  it('allows the configured attempts then returns the remaining retry window', () => {
    const limiter = new FixedWindowRateLimiter()

    expect(limiter.consume('login:ip', 2, 60_000, 1_000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
    expect(limiter.consume('login:ip', 2, 60_000, 2_000).allowed).toBe(true)
    expect(limiter.consume('login:ip', 2, 60_000, 31_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    })
  })

  it('opens a fresh window after expiry without affecting another key', () => {
    const limiter = new FixedWindowRateLimiter()
    limiter.consume('first', 1, 1_000, 0)
    limiter.consume('second', 1, 1_000, 500)

    expect(limiter.consume('first', 1, 1_000, 1_001).allowed).toBe(true)
    expect(limiter.consume('second', 1, 1_000, 1_001).allowed).toBe(false)
  })
})
