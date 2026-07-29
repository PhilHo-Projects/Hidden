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

  it('periodically discards expired keys so attacker-controlled names do not accumulate', () => {
    const limiter = new FixedWindowRateLimiter()
    for (let index = 0; index < 300; index += 1) {
      limiter.consume(`login:${index}`, 1, 1_000, index)
    }

    limiter.consume('current', 1, 1_000, 10_000)

    expect(limiter.entryCount).toBe(1)
  })

  it('fails closed for new keys once its hard capacity is reached', () => {
    const limiter = new FixedWindowRateLimiter(2)
    limiter.consume('first', 1, 60_000, 1_000)
    limiter.consume('second', 1, 60_000, 1_000)

    expect(limiter.consume('third', 1, 60_000, 1_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    })
    expect(limiter.entryCount).toBe(2)
  })
})
