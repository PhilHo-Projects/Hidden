import { decode, encode } from '@msgpack/msgpack'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { AuthServiceLike } from './auth/http'
import type { AuthenticatedUser } from './auth/service'
import { createHiddenServer, type HiddenServer } from './app'
import { DEFAULT_MATCH_RULES } from './matchRules'
import { PacketType } from './protocol'

const ORIGIN = 'http://localhost:5173'
const VALID_SESSION_TOKEN = 'v'.repeat(43)
const PLAYER_SESSION_TOKEN = 'p'.repeat(43)
const ADMIN_SESSION_TOKEN = 'a'.repeat(43)
const SECOND_ADMIN_SESSION_TOKEN = 'b'.repeat(43)

class Probe {
  private readonly buffered: unknown[][] = []
  private readonly waiters: Array<{
    predicate: (packet: unknown[]) => boolean
    resolve: (packet: unknown[]) => void
  }> = []

  constructor(readonly socket: WebSocket) {
    socket.on('message', (bytes) => {
      const packet = decode(bytes as Buffer) as unknown[]
      const waiterIndex = this.waiters.findIndex(({ predicate }) =>
        predicate(packet),
      )
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1)
        waiter?.resolve(packet)
      } else {
        this.buffered.push(packet)
      }
    })
  }

  waitFor(type: PacketType, timeoutMs = 1500) {
    const predicate = (packet: unknown[]) => Number(packet[1]) === type
    const bufferedIndex = this.buffered.findIndex(predicate)
    if (bufferedIndex >= 0) {
      return Promise.resolve(this.buffered.splice(bufferedIndex, 1)[0]!)
    }

    return new Promise<unknown[]>((resolve, reject) => {
      const waiter = { predicate, resolve }
      this.waiters.push(waiter)
      const timeout = setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error(`Timed out waiting for packet ${type}.`))
      }, timeoutMs)
      waiter.resolve = (packet) => {
        clearTimeout(timeout)
        resolve(packet)
      }
    })
  }

  send(packet: unknown[]) {
    this.socket.send(encode(packet))
  }

  close() {
    this.socket.close()
  }
}

async function connectProbe(
  port: number,
  origin = ORIGIN,
  pathname = '/ws',
  cookie?: string,
) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, {
    origin,
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
  })
  const probe = new Probe(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return probe
}

async function expectUpgradeStatus(
  port: number,
  statusCode: number,
  origin = ORIGIN,
  pathname = '/ws',
  cookie?: string,
) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, {
    origin,
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      try {
        expect(response.statusCode).toBe(statusCode)
        resolve()
      } catch (error) {
        reject(error)
      } finally {
        response.destroy()
      }
    })
    socket.once('open', () => reject(new Error('Upgrade unexpectedly succeeded.')))
    socket.once('error', () => {})
  })
}

function authServiceForSessions(
  sessions: ReadonlyMap<string, AuthenticatedUser>,
): AuthServiceLike {
  return {
    async getSession(rawToken) {
      return rawToken ? sessions.get(rawToken) : undefined
    },
    async cleanupExpiredSessions() {
      return 0
    },
    async logout() {},
    async login(): Promise<never> {
      throw new Error('Not used by this test.')
    },
    async register(): Promise<never> {
      throw new Error('Not used by this test.')
    },
  }
}

async function queueProbe(
  port: number,
  options: {
    cookie?: string
    guestUsername?: string
    proposedRules?: unknown
  } = {},
) {
  const probe = await connectProbe(
    port,
    ORIGIN,
    '/ws',
    options.cookie,
  )
  await probe.waitFor(PacketType.ID_ASSIGN)

  if (options.guestUsername) {
    probe.send([999, PacketType.USER_INFO, options.guestUsername])
    await probe.waitFor(PacketType.SERVER_RESPONSE)
  }

  probe.send([999, PacketType.ROOM_JOIN, 'lobby'])
  await probe.waitFor(PacketType.SERVER_RESPONSE)
  probe.send([
    999,
    PacketType.MATCHMAKING_REQUEST,
    true,
    ...(options.proposedRules === undefined ? [] : [options.proposedRules]),
  ])
  return probe
}

let server: HiddenServer | undefined
let staticRoot: string | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  if (staticRoot) {
    await rm(staticRoot, { recursive: true, force: true })
    staticRoot = undefined
  }
})

async function startServer(
  overrides: Partial<Parameters<typeof createHiddenServer>[0]> = {},
) {
  staticRoot = await mkdtemp(path.join(tmpdir(), 'hidden-static-'))
  await writeFile(
    path.join(staticRoot, 'index.html'),
    '<!doctype html><title>Hidden test shell</title>',
  )
  server = createHiddenServer({
    allowedOrigins: [ORIGIN],
    heartbeatIntervalMs: 0,
    logLevel: 'silent',
    port: 0,
    staticRoot,
    ...overrides,
  })
  return server.start()
}

describe.sequential('Hidden server', () => {
  it('serves health and the React shell while restricting websocket upgrades', async () => {
    const { port } = await startServer()

    const health = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })

    const shell = await fetch(`http://127.0.0.1:${port}/battle/room`)
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain('Hidden test shell')

    await expectUpgradeStatus(port, 404, ORIGIN, '/not-ws')
    await expectUpgradeStatus(port, 403, 'https://evil.example')
  })

  it('matches two clients, starts their game, relays their move with the real sender id, and reports disconnects', async () => {
    const { port } = await startServer()
    const first = await connectProbe(port)
    const second = await connectProbe(port)

    const firstId = Number((await first.waitFor(PacketType.ID_ASSIGN))[2])
    const secondId = Number((await second.waitFor(PacketType.ID_ASSIGN))[2])

    first.send([999, PacketType.USER_INFO, 'Guest#0001'])
    second.send([999, PacketType.USER_INFO, 'Guest#0002'])
    await Promise.all([
      first.waitFor(PacketType.SERVER_RESPONSE),
      second.waitFor(PacketType.SERVER_RESPONSE),
    ])

    first.send([999, PacketType.ROOM_JOIN, 'lobby'])
    second.send([999, PacketType.ROOM_JOIN, 'lobby'])
    await Promise.all([
      first.waitFor(PacketType.SERVER_RESPONSE),
      second.waitFor(PacketType.SERVER_RESPONSE),
    ])

    first.send([999, PacketType.MATCHMAKING_REQUEST, true])
    second.send([999, PacketType.MATCHMAKING_REQUEST, true])
    const [firstMatch, secondMatch] = await Promise.all([
      first.waitFor(PacketType.MATCH_FOUND),
      second.waitFor(PacketType.MATCH_FOUND),
    ])
    expect(firstMatch[2]).toBe(secondMatch[2])

    first.send([999, PacketType.READY_STATE, true])
    second.send([999, PacketType.READY_STATE, true])
    const [firstStart, secondStart] = await Promise.all([
      first.waitFor(PacketType.GAME_START),
      second.waitFor(PacketType.GAME_START),
    ])
    expect([firstId, secondId]).toContain(Number(firstStart[2]))
    expect(firstStart[2]).toBe(secondStart[2])
    expect(firstStart.slice(0, 3)).toEqual([
      0,
      PacketType.GAME_START,
      firstStart[2],
    ])
    expect(firstStart[3]).toEqual(secondStart[3])
    expect(firstStart[3]).toMatchObject({
      matchId: expect.any(String),
      mode: { id: 'classic', revision: 1 },
      rules: DEFAULT_MATCH_RULES,
      seed: expect.any(Number),
      firstSeat: firstStart[2] === firstId ? 0 : 1,
      revision: 0,
      turnTimeRemainingMs: expect.any(Number),
    })
    expect(JSON.stringify(firstStart[3])).not.toContain('accountId')

    first.send([999, PacketType.READY_STATE, true])
    second.send([999, PacketType.READY_STATE, true])
    const [firstRematch, secondRematch] = await Promise.all([
      first.waitFor(PacketType.GAME_START),
      second.waitFor(PacketType.GAME_START),
    ])
    expect([firstId, secondId]).toContain(Number(firstRematch[2]))
    expect(firstRematch[2]).toBe(secondRematch[2])
    expect(firstRematch[3]).toEqual(secondRematch[3])
    expect(firstRematch[3]).toMatchObject({
      matchId: expect.any(String),
      rules: DEFAULT_MATCH_RULES,
      revision: 0,
    })
    expect((firstRematch[3] as { matchId: string }).matchId).not.toBe(
      (firstStart[3] as { matchId: string }).matchId,
    )

    first.send([999, PacketType.GAME_MOVE, 4, 'green'])
    expect(await second.waitFor(PacketType.GAME_MOVE)).toEqual([
      firstId,
      PacketType.GAME_MOVE,
      4,
      'green',
    ])

    first.close()
    expect(await second.waitFor(PacketType.OPPONENT_DISCONNECTED)).toEqual([
      0,
      PacketType.OPPONENT_DISCONNECTED,
      true,
    ])
    second.close()
  })

  it('ignores a non-admin rules proposal and sends defaults to both players', async () => {
    const authService = authServiceForSessions(
      new Map([
        [
          PLAYER_SESSION_TOKEN,
          {
            id: 'c227de2f-1fd1-4830-ac54-4d9f4daaecc5',
            role: 'player',
            username: 'Regular_Player',
          },
        ],
      ]),
    )
    const { port } = await startServer({
      authService,
      sessionCookieSecure: false,
    })
    const player = await queueProbe(port, {
      cookie: `hidden_session=${PLAYER_SESSION_TOKEN}`,
      proposedRules: { rounds: 3, turnSeconds: 30, blindMode: false },
    })
    const guest = await queueProbe(port, { guestUsername: 'Guest#1001' })

    const [playerMatch, guestMatch] = await Promise.all([
      player.waitFor(PacketType.MATCH_FOUND),
      guest.waitFor(PacketType.MATCH_FOUND),
    ])

    expect(playerMatch[3]).toEqual(DEFAULT_MATCH_RULES)
    expect(guestMatch[3]).toEqual(DEFAULT_MATCH_RULES)
    player.close()
    guest.close()
  })

  it('applies and clamps an admin proposal identically for both players', async () => {
    const authService = authServiceForSessions(
      new Map([
        [
          ADMIN_SESSION_TOKEN,
          {
            id: 'a229d266-4c67-47d2-b6e3-f4e169a59f1f',
            role: 'admin',
            username: 'Ecco',
          },
        ],
      ]),
    )
    const { port } = await startServer({
      authService,
      sessionCookieSecure: false,
    })
    const admin = await queueProbe(port, {
      cookie: `hidden_session=${ADMIN_SESSION_TOKEN}`,
      proposedRules: { rounds: 999, turnSeconds: 0, blindMode: false },
    })
    const guest = await queueProbe(port, { guestUsername: 'Guest#1002' })

    const [adminMatch, guestMatch] = await Promise.all([
      admin.waitFor(PacketType.MATCH_FOUND),
      guest.waitFor(PacketType.MATCH_FOUND),
    ])

    const expected = { rounds: 20, turnSeconds: 2, blindMode: false }
    expect(adminMatch[3]).toEqual(expected)
    expect(guestMatch[3]).toEqual(expected)
    admin.close()
    guest.close()
  })

  it('defaults a malformed admin proposal without closing the socket', async () => {
    const authService = authServiceForSessions(
      new Map([
        [
          ADMIN_SESSION_TOKEN,
          {
            id: '0e5b79b4-9150-4aaa-af9b-c9565d619bd9',
            role: 'admin',
            username: 'Ecco',
          },
        ],
      ]),
    )
    const { port } = await startServer({
      authService,
      sessionCookieSecure: false,
    })
    const admin = await queueProbe(port, {
      cookie: `hidden_session=${ADMIN_SESSION_TOKEN}`,
      proposedRules: { rounds: 4, turnSeconds: 'bad', blindMode: true },
    })
    const guest = await queueProbe(port, { guestUsername: 'Guest#1003' })

    const [adminMatch, guestMatch] = await Promise.all([
      admin.waitFor(PacketType.MATCH_FOUND),
      guest.waitFor(PacketType.MATCH_FOUND),
    ])

    expect(adminMatch[3]).toEqual(DEFAULT_MATCH_RULES)
    expect(guestMatch[3]).toEqual(DEFAULT_MATCH_RULES)
    expect(admin.socket.readyState).toBe(WebSocket.OPEN)
    admin.close()
    guest.close()
  })

  it('uses the earlier queue entry when two admins propose different rules', async () => {
    const authService = authServiceForSessions(
      new Map([
        [
          ADMIN_SESSION_TOKEN,
          {
            id: '83bad335-2d79-48ab-8900-94d04a2cc50a',
            role: 'admin',
            username: 'First_Admin',
          },
        ],
        [
          SECOND_ADMIN_SESSION_TOKEN,
          {
            id: '349b555d-bf52-434c-92c7-4797b4dac3a7',
            role: 'admin',
            username: 'Second_Admin',
          },
        ],
      ]),
    )
    const { port } = await startServer({
      authService,
      sessionCookieSecure: false,
    })
    const first = await queueProbe(port, {
      cookie: `hidden_session=${ADMIN_SESSION_TOKEN}`,
      proposedRules: { rounds: 4, turnSeconds: 12, blindMode: false },
    })
    const second = await queueProbe(port, {
      cookie: `hidden_session=${SECOND_ADMIN_SESSION_TOKEN}`,
      proposedRules: { rounds: 9, turnSeconds: 30, blindMode: true },
    })

    const [firstMatch, secondMatch] = await Promise.all([
      first.waitFor(PacketType.MATCH_FOUND),
      second.waitFor(PacketType.MATCH_FOUND),
    ])

    const expected = { rounds: 4, turnSeconds: 12, blindMode: false }
    expect(firstMatch[3]).toEqual(expected)
    expect(secondMatch[3]).toEqual(expected)
    first.close()
    second.close()
  })

  it('clears an admin proposal when matchmaking is cancelled', async () => {
    const authService = authServiceForSessions(
      new Map([
        [
          ADMIN_SESSION_TOKEN,
          {
            id: 'ce8495b2-b61a-47b7-9eed-21d253536474',
            role: 'admin',
            username: 'Ecco',
          },
        ],
      ]),
    )
    const { port } = await startServer({
      authService,
      sessionCookieSecure: false,
    })
    const admin = await queueProbe(port, {
      cookie: `hidden_session=${ADMIN_SESSION_TOKEN}`,
      proposedRules: { rounds: 4, turnSeconds: 20, blindMode: false },
    })
    admin.send([999, PacketType.MATCHMAKING_REQUEST, false])
    admin.send([999, PacketType.MATCHMAKING_REQUEST, true])
    const guest = await queueProbe(port, { guestUsername: 'Guest#1004' })

    const [adminMatch, guestMatch] = await Promise.all([
      admin.waitFor(PacketType.MATCH_FOUND),
      guest.waitFor(PacketType.MATCH_FOUND),
    ])

    expect(adminMatch[3]).toEqual(DEFAULT_MATCH_RULES)
    expect(guestMatch[3]).toEqual(DEFAULT_MATCH_RULES)
    admin.close()
    guest.close()
  })

  it('closes clients that send malformed packets or exceed the message rate', async () => {
    const { port } = await startServer({ maxMessagesPerSecond: 2 })
    const malformed = await connectProbe(port)
    await malformed.waitFor(PacketType.ID_ASSIGN)
    malformed.send([1, PacketType.GAME_MOVE, 9, 'green'])
    const malformedCode = await new Promise<number>((resolve) =>
      malformed.socket.once('close', resolve),
    )
    expect(malformedCode).toBe(1008)

    const flood = await connectProbe(port)
    await flood.waitFor(PacketType.ID_ASSIGN)
    flood.send([1, PacketType.USER_INFO, 'One'])
    flood.send([1, PacketType.USER_INFO, 'Two'])
    flood.send([1, PacketType.USER_INFO, 'Three'])
    const floodCode = await new Promise<number>((resolve) =>
      flood.socket.once('close', resolve),
    )
    expect(floodCode).toBe(1008)
  })

  it('enforces the connection and payload ceilings', async () => {
    const { port } = await startServer({ maxConnections: 1 })
    const first = await connectProbe(port)
    await first.waitFor(PacketType.ID_ASSIGN)
    await expectUpgradeStatus(port, 503)

    first.socket.send(Buffer.alloc(16 * 1024 + 1))
    const closeCode = await new Promise<number>((resolve) =>
      first.socket.once('close', resolve),
    )
    expect(closeCode).toBe(1009)
  })

  it('counts authenticated upgrades while their session lookup is pending', async () => {
    let lookupCount = 0
    let markLookupStarted: (() => void) | undefined
    let releaseFirstLookup: (() => void) | undefined
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve
    })
    const firstLookupBlocked = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve
    })
    const user = {
      id: '51314c8f-2d1f-4be5-a3e3-33f5b29d8c84',
      role: 'player' as const,
      username: 'Account_Player',
    }
    const authService = {
      async getSession() {
        lookupCount += 1
        if (lookupCount === 1) {
          markLookupStarted?.()
          await firstLookupBlocked
        }
        return user
      },
      async cleanupExpiredSessions() {
        return 0
      },
      async logout() {},
      async login(): Promise<never> {
        throw new Error('Not used by this test.')
      },
      async register(): Promise<never> {
        throw new Error('Not used by this test.')
      },
    } satisfies AuthServiceLike
    const { port } = await startServer({
      authService,
      maxConnections: 1,
      sessionCookieSecure: false,
    })
    const firstSocket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: ORIGIN,
      headers: { Cookie: `hidden_session=${VALID_SESSION_TOKEN}` },
    })
    const firstRejected = new Promise<void>((resolve, reject) => {
      firstSocket.once('unexpected-response', (_request, response) => {
        try {
          expect(response.statusCode).toBe(503)
          resolve()
        } catch (error) {
          reject(error)
        } finally {
          response.destroy()
        }
      })
      firstSocket.once('open', () =>
        reject(new Error('Pending authenticated upgrade exceeded the limit.')),
      )
      firstSocket.once('error', () => undefined)
    })

    await lookupStarted
    let guest: Probe | undefined
    try {
      guest = await connectProbe(port)
      await expect(
        guest.waitFor(PacketType.ID_ASSIGN),
      ).resolves.toBeDefined()
      await expectUpgradeStatus(
        port,
        503,
        ORIGIN,
        '/ws',
        `hidden_session=${VALID_SESSION_TOKEN}`,
      )
      releaseFirstLookup?.()
      await firstRejected
    } finally {
      releaseFirstLookup?.()
      guest?.close()
      firstSocket.terminate()
    }
  })

  it('closes sockets whose session lookup is still pending during shutdown', async () => {
    let markLookupStarted: (() => void) | undefined
    let releaseLookup: (() => void) | undefined
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve
    })
    const blockedLookup = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    const authService = {
      async getSession() {
        markLookupStarted?.()
        await blockedLookup
        return undefined
      },
      async cleanupExpiredSessions() {
        return 0
      },
      async logout() {},
      async login(): Promise<never> {
        throw new Error('Not used by this test.')
      },
      async register(): Promise<never> {
        throw new Error('Not used by this test.')
      },
    } satisfies AuthServiceLike
    const { port } = await startServer({
      authService,
      sessionCookieSecure: false,
      shutdownGraceMs: 25,
    })
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: ORIGIN,
      headers: { Cookie: `hidden_session=${VALID_SESSION_TOKEN}` },
    })
    socket.on('error', () => undefined)
    const socketClosed = new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
    })

    await lookupStarted
    try {
      await server?.close()
      await expect(
        Promise.race([
          socketClosed.then(() => true),
          new Promise<false>((resolve) =>
            setTimeout(() => resolve(false), 200),
          ),
        ]),
      ).resolves.toBe(true)
    } finally {
      releaseLookup?.()
      socket.terminate()
    }
  })

  it('keeps the shutdown grace timer active for an unresponsive established socket', async () => {
    const shutdownGraceMs = 25
    const { port } = await startServer({ shutdownGraceMs })
    const probe = await connectProbe(port)
    const transport = (
      probe.socket as WebSocket & {
        _socket: { pause(): void }
      }
    )._socket
    transport.pause()
    const startedAt = Date.now()

    try {
      await server?.close()
      const elapsedMs = Date.now() - startedAt
      expect(elapsedMs).toBeGreaterThanOrEqual(shutdownGraceMs - 10)
      expect(elapsedMs).toBeLessThan(500)
    } finally {
      probe.socket.terminate()
    }
  })

  it('binds an authenticated socket to the account username instead of client input', async () => {
    const authService = {
      async getSession(rawToken: string | undefined) {
        return rawToken === VALID_SESSION_TOKEN
          ? {
              id: '51314c8f-2d1f-4be5-a3e3-33f5b29d8c84',
              role: 'player' as const,
              username: 'Account_Player',
            }
          : undefined
      },
      async cleanupExpiredSessions() {
        return 0
      },
      async logout() {},
      async login(): Promise<never> {
        throw new Error('Not used by this test.')
      },
      async register(): Promise<never> {
        throw new Error('Not used by this test.')
      },
    } satisfies AuthServiceLike
    const { port } = await startServer({
      authService,
      sessionCookieSecure: false,
    })
    const account = await connectProbe(
      port,
      ORIGIN,
      '/ws',
      `hidden_session=${VALID_SESSION_TOKEN}`,
    )
    const accountId = Number((await account.waitFor(PacketType.ID_ASSIGN))[2])

    account.send([999, PacketType.USER_INFO, 'Spoofed_Name'])
    const users = await account.waitFor(PacketType.USER_INFO)

    expect(users[2]).toContainEqual([accountId, 'Account_Player'])
    await expect(
      account.waitFor(PacketType.SERVER_RESPONSE),
    ).resolves.toContain(true)
    account.close()
  })

  it('rejects a guest that announces an account-shaped username', async () => {
    const { port } = await startServer()
    const guest = await connectProbe(port)
    await guest.waitFor(PacketType.ID_ASSIGN)

    guest.send([999, PacketType.USER_INFO, 'Account_Player'])
    const closeCode = await new Promise<number>((resolve) =>
      guest.socket.once('close', resolve),
    )

    expect(closeCode).toBe(1008)
  })

  it('rejects cookie-bearing upgrades when session validation fails but still admits cookie-less guests', async () => {
    const authService = {
      async getSession() {
        throw new Error('database unavailable')
      },
      async cleanupExpiredSessions() {
        return 0
      },
      async logout() {},
      async login(): Promise<never> {
        throw new Error('Not used by this test.')
      },
      async register(): Promise<never> {
        throw new Error('Not used by this test.')
      },
    } satisfies AuthServiceLike
    const { port } = await startServer({
      authService,
      sessionCookieSecure: false,
    })

    await expectUpgradeStatus(
      port,
      503,
      ORIGIN,
      '/ws',
      `hidden_session=${VALID_SESSION_TOKEN}`,
    )
    const guest = await connectProbe(port)
    await expect(guest.waitFor(PacketType.ID_ASSIGN)).resolves.toBeDefined()
    guest.close()
  })
})
