import { describe, expect, it } from 'vitest'
import type {
  AuthRepository,
  AuthUser,
  UserWithPassword,
} from './repository'
import { UsernameTakenError } from './repository'
import {
  AuthService,
  AuthServiceError,
  SESSION_DURATION_MS,
} from './service'
import { hashSessionToken } from './sessionToken'
import { verifyPassword } from './password'

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, UserWithPassword>()
  readonly sessions = new Map<string, { userId: string; expiresAt: Date }>()

  async createAccount(input: {
    id: string
    username: string
    usernameKey: string
    passwordHash: string
    sessionTokenHash: Buffer
    previousTokenHash?: Buffer
    expiresAt: Date
  }) {
    if (this.users.has(input.usernameKey)) {
      throw new UsernameTakenError()
    }
    if (input.previousTokenHash) {
      this.sessions.delete(input.previousTokenHash.toString('hex'))
    }
    const user = {
      id: input.id,
      username: input.username,
      passwordHash: input.passwordHash,
    }
    this.users.set(input.usernameKey, user)
    this.sessions.set(input.sessionTokenHash.toString('hex'), {
      userId: input.id,
      expiresAt: input.expiresAt,
    })
    return { id: input.id, username: input.username }
  }

  async findUserByUsernameKey(usernameKey: string) {
    return this.users.get(usernameKey)
  }

  async createSession(input: {
    userId: string
    tokenHash: Buffer
    previousTokenHash?: Buffer
    expiresAt: Date
  }) {
    if (input.previousTokenHash) {
      this.sessions.delete(input.previousTokenHash.toString('hex'))
    }
    this.sessions.set(input.tokenHash.toString('hex'), {
      userId: input.userId,
      expiresAt: input.expiresAt,
    })
  }

  async findSession(tokenHash: Buffer, now: Date) {
    const session = this.sessions.get(tokenHash.toString('hex'))
    if (!session || session.expiresAt <= now) {
      return undefined
    }
    return [...this.users.values()]
      .filter((user) => user.id === session.userId)
      .map(({ id, username }) => ({ id, username }))[0]
  }

  async deleteSession(tokenHash: Buffer) {
    this.sessions.delete(tokenHash.toString('hex'))
  }

  async deleteExpiredSessions(now: Date) {
    let deleted = 0
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token)
        deleted += 1
      }
    }
    return deleted
  }
}

const NOW = new Date('2030-01-01T00:00:00.000Z')

async function createService(repository = new MemoryAuthRepository()) {
  return {
    repository,
    service: await AuthService.create(repository, {
      now: () => new Date(NOW),
      createUserId: () => 'd4a30a54-ca74-4b38-ac7f-e82e6e9e2510',
    }),
  }
}

describe('AuthService', () => {
  it('registers a case-insensitive account and returns a 30-day session', async () => {
    const { repository, service } = await createService()
    const result = await service.register({
      username: '  Player_One ',
      password: 'correct horse battery staple',
    })
    const stored = repository.users.get('player_one')

    expect(result.user).toEqual({
      id: 'd4a30a54-ca74-4b38-ac7f-e82e6e9e2510',
      username: 'Player_One',
    })
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.expiresAt.getTime() - NOW.getTime()).toBe(
      SESSION_DURATION_MS,
    )
    expect(stored?.passwordHash).not.toContain('correct horse battery staple')
    await expect(
      verifyPassword(
        stored!.passwordHash,
        'correct horse battery staple',
      ),
    ).resolves.toBe(true)
  })

  it('reports a stable username_taken error for duplicates', async () => {
    const { service } = await createService()
    await service.register({
      username: 'Player_One',
      password: 'correct horse battery staple',
    })

    await expect(
      service.register({
        username: 'player_one',
        password: 'another valid password',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AuthServiceError>>({
        code: 'username_taken',
        field: 'username',
      }),
    )
  })

  it('uses the same invalid_credentials error for unknown users and bad passwords', async () => {
    const { service } = await createService()
    await service.register({
      username: 'Player_One',
      password: 'correct horse battery staple',
    })

    for (const input of [
      { username: 'Missing_User', password: 'correct horse battery staple' },
      { username: 'Player_One', password: 'definitely the wrong password' },
    ]) {
      await expect(service.login(input)).rejects.toEqual(
        expect.objectContaining<Partial<AuthServiceError>>({
          code: 'invalid_credentials',
        }),
      )
    }
  })

  it('replaces only the presented browser session and resolves then revokes the new one', async () => {
    const { repository, service } = await createService()
    const registration = await service.register({
      username: 'Player_One',
      password: 'correct horse battery staple',
    })
    const otherBrowser = await service.login({
      username: 'Player_One',
      password: 'correct horse battery staple',
    })
    const replacement = await service.login(
      {
        username: 'Player_One',
        password: 'correct horse battery staple',
      },
      registration.rawToken,
    )

    expect(
      repository.sessions.has(
        hashSessionToken(registration.rawToken).toString('hex'),
      ),
    ).toBe(false)
    await expect(service.getSession(otherBrowser.rawToken)).resolves.toEqual(
      otherBrowser.user,
    )
    await expect(service.getSession(replacement.rawToken)).resolves.toEqual(
      replacement.user,
    )

    await service.logout(replacement.rawToken)
    await expect(
      service.getSession(replacement.rawToken),
    ).resolves.toBeUndefined()
    await expect(service.getSession(otherBrowser.rawToken)).resolves.toEqual(
      otherBrowser.user,
    )
  })
})
