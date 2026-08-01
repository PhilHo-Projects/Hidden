import { describe, expect, it } from 'vitest'
import {
  clampMatchRules,
  decodeMatchRules,
} from './matchRules'

describe('match rules', () => {
  it('accepts a complete typed wire map without changing its values', () => {
    expect(
      decodeMatchRules({
        rounds: 8,
        turnSeconds: 15,
        blindMode: false,
      }),
    ).toEqual({
      rounds: 8,
      turnSeconds: 15,
      blindMode: false,
    })
  })

  it.each([
    undefined,
    null,
    [],
    { rounds: 8, turnSeconds: 15 },
    { rounds: 8, turnSeconds: '15', blindMode: false },
    { rounds: Number.NaN, turnSeconds: 15, blindMode: false },
  ])('treats malformed or partially typed wire rules as absent', (value) => {
    expect(decodeMatchRules(value)).toBeUndefined()
  })

  it('clamps finite numbers and defaults invalid fields independently', () => {
    expect(
      clampMatchRules({
        rounds: 999,
        turnSeconds: 0,
        blindMode: false,
      }),
    ).toEqual({
      rounds: 20,
      turnSeconds: 2,
      blindMode: false,
    })
    expect(
      clampMatchRules({
        rounds: Number.NEGATIVE_INFINITY,
        turnSeconds: 'fast',
        blindMode: 1,
      }),
    ).toEqual({
      rounds: 6,
      turnSeconds: 10,
      blindMode: true,
    })
  })
})
