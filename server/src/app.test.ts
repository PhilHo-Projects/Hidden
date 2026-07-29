import { decode, encode } from '@msgpack/msgpack'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { AuthServiceLike } from './auth/http'
import { createHiddenServer, type HiddenServer } from './app'
import { PacketType } from './protocol'

const ORIGIN = 'http://localhost:5173'

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

  it('binds an authenticated socket to the account username instead of client input', async () => {
    const authService = {
      async getSession(rawToken: string | undefined) {
        return rawToken === 'valid-session'
          ? {
              id: '51314c8f-2d1f-4be5-a3e3-33f5b29d8c84',
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
      'hidden_session=valid-session',
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
      'hidden_session=valid-session',
    )
    const guest = await connectProbe(port)
    await expect(guest.waitFor(PacketType.ID_ASSIGN)).resolves.toBeDefined()
    guest.close()
  })
})
