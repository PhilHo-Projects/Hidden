import { describe, expect, it, vi } from 'vitest'
import { consumeAuthRedirect } from './authRedirect'

describe('auth redirect consumption', () => {
  it('captures a reset token in memory and removes all auth material from the URL', () => {
    const replace = vi.fn()
    const intent = consumeAuthRedirect(
      new URL('https://hidden.example/?auth=reset-password&token=top-secret&keep=yes#board'),
      replace,
    )

    expect(intent).toEqual({ view: 'reset', token: 'top-secret' })
    expect(replace).toHaveBeenCalledWith('/?keep=yes#board')
    expect(JSON.stringify(replace.mock.calls)).not.toContain('top-secret')
  })

  it('captures verification success or safe redirect errors without preserving them in history', () => {
    const verifiedReplace = vi.fn()
    const failedReplace = vi.fn()

    expect(consumeAuthRedirect(
      new URL('https://hidden.example/?auth=verified'),
      verifiedReplace,
    )).toEqual({ view: 'verified' })
    expect(verifiedReplace).toHaveBeenCalledWith('/')

    expect(consumeAuthRedirect(
      new URL('https://hidden.example/?auth=reset-password&error=INVALID_TOKEN'),
      failedReplace,
    )).toEqual({ view: 'reset', error: 'INVALID_TOKEN' })
    expect(failedReplace).toHaveBeenCalledWith('/')
  })

  it('leaves ordinary game URLs untouched', () => {
    const replace = vi.fn()
    expect(consumeAuthRedirect(
      new URL('https://hidden.example/?room=ABCD'),
      replace,
    )).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })
})
