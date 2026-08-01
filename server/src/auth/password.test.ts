import { describe, expect, it } from 'vitest'
import {
  CredentialValidationError,
  hashPassword,
  parseCredentials,
  verifyPassword,
} from './password'

describe('account credentials', () => {
  it('normalizes a valid public username without changing the password', () => {
    expect(
      parseCredentials({
        username: '  Player_One  ',
        password: 'correct horse battery staple',
      }),
    ).toEqual({
      username: 'Player_One',
      usernameKey: 'player_one',
      password: 'correct horse battery staple',
    })
  })

  it('accepts every password character without trimming or composition rules', () => {
    const password = `  valid\u0000password  `

    expect(
      parseCredentials({
        username: 'Player',
        password,
      }).password,
    ).toBe(password)
  })

  it.each([
    [{ username: 'ab', password: 'valid password' }, 'username'],
    [{ username: 'Player-One', password: 'valid password' }, 'username'],
    [{ username: 'Player', password: 'short' }, 'password'],
  ])('rejects invalid credentials for %s', (input, field) => {
    expect(() => parseCredentials(input)).toThrowError(
      expect.objectContaining<Partial<CredentialValidationError>>({ field }),
    )
  })

  it('accepts a password at the eight character minimum', () => {
    expect(
      parseCredentials({ username: 'Player', password: '12345678' }).password,
    ).toBe('12345678')
  })

  it('rejects a password one character below the minimum and says the real bound', () => {
    expect(() =>
      parseCredentials({ username: 'Player', password: '1234567' }),
    ).toThrowError(
      expect.objectContaining<Partial<CredentialValidationError>>({
        field: 'password',
        message: 'Password must contain 8–128 characters.',
      }),
    )
  })

  it('reports the same bound when the password is missing entirely', () => {
    expect(() => parseCredentials({ username: 'Player' })).toThrowError(
      expect.objectContaining<Partial<CredentialValidationError>>({
        field: 'password',
        message: 'Password must contain 8–128 characters.',
      }),
    )
  })

  it('counts the minimum in characters rather than bytes', () => {
    // Eight code points, but well over eight UTF-8 bytes.
    const password = '🎮🎯🎲🃏🎰🎪🎨🎭'

    expect(
      parseCredentials({ username: 'Player', password }).password,
    ).toBe(password)
  })

  it('hashes with the approved Argon2id parameters and verifies without exposing the password', async () => {
    const password = 'correct horse battery staple'
    const encoded = await hashPassword(password)

    expect(encoded).toMatch(
      /^\$hidden\$argon2id\$v=19\$m=19456,t=2,p=1,l=32\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/,
    )
    expect(encoded).not.toContain(password)
    await expect(verifyPassword(encoded, password)).resolves.toBe(true)
    await expect(verifyPassword(encoded, 'wrong password')).resolves.toBe(false)
  })

  it('uses a unique random salt for every password hash', async () => {
    const first = await hashPassword('correct horse battery staple')
    const second = await hashPassword('correct horse battery staple')

    expect(first).not.toBe(second)
  })
})
