import { DEFAULT_GAME_CONFIG, ENGINE_REVISION } from '@hidden/game-core'
import { decode, encode } from '@msgpack/msgpack'
import { afterEach, describe, expect, it } from 'vitest'
import { NetworkClient, resolveWebSocketUrl } from '../networkClient'
import { PacketType } from '../protocol'

class OpenSocket {
  static OPEN = 1
  readyState = OpenSocket.OPEN
  send() {}
}

class RecordingSocket {
  static OPEN = 1
  static instances: RecordingSocket[] = []
  readyState = RecordingSocket.OPEN
  binaryType = ''
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { reason: string }) => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  readonly sent: unknown[][] = []

  constructor() {
    RecordingSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.())
  }

  send(bytes: Uint8Array) {
    this.sent.push(decode(bytes) as unknown[])
  }

  receive(packet: unknown[]) {
    const bytes = encode(packet)
    this.onmessage?.({
      data: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    })
  }

  close() {
    this.readyState = 3
    this.onclose?.({ reason: '' })
  }
}

const originalWebSocket = globalThis.WebSocket

afterEach(() => {
  RecordingSocket.instances = []
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: originalWebSocket,
  })
})

describe('resolveWebSocketUrl', () => {
  it('uses the secure same-origin websocket endpoint for hosted HTTPS', () => {
    expect(
      resolveWebSocketUrl({
        protocol: 'https:',
        host: 'hidden.philippeho.dev',
      }),
    ).toBe('wss://hidden.philippeho.dev/ws')
  })

  it('uses the Vite websocket proxy during local HTTP development', () => {
    expect(
      resolveWebSocketUrl({
        protocol: 'http:',
        host: 'localhost:5173',
      }),
    ).toBe('ws://localhost:5173/ws')
  })

  it('prefers an explicit remote websocket override', () => {
    expect(
      resolveWebSocketUrl({
        override: 'wss://hidden.philippeho.dev/ws',
        protocol: 'http:',
        host: 'localhost:5173',
      }),
    ).toBe('wss://hidden.philippeho.dev/ws')
  })

  it('rejects a request when the server response does not arrive', async () => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: OpenSocket,
    })

    const client = new NetworkClient({ responseTimeoutMs: 10 })
    ;(client as unknown as { ws: OpenSocket }).ws = new OpenSocket()

    const outcome = await Promise.race([
      client.sendUserName('EchoStrike').then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.message : 'rejected'),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 50)),
    ])

    expect(outcome).toBe('Server response timed out.')
  })

  it('sends admin rules and emits the authoritative match-found rules', async () => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: RecordingSocket,
    })
    const client = new NetworkClient()
    const events: unknown[] = []
    client.subscribe((event) => events.push(event))
    await client.connect('ws://localhost:5173/ws')
    const socket = RecordingSocket.instances[0]!
    socket.receive([0, PacketType.ID_ASSIGN, 7])

    client.startMatchmaking({
      ...DEFAULT_GAME_CONFIG,
      rounds: 8,
      turnSeconds: 15,
      blindMode: false,
    })
    expect(socket.sent.at(-1)).toEqual([
      7,
      PacketType.MATCHMAKING_REQUEST,
      true,
      { ...DEFAULT_GAME_CONFIG, rounds: 8, turnSeconds: 15, blindMode: false },
    ])

    socket.receive([
      0,
      PacketType.MATCH_FOUND,
      'room-1',
      { ...DEFAULT_GAME_CONFIG, rounds: 999, turnSeconds: 0 },
    ])
    expect(events).toContainEqual({
      type: 'match-found',
      roomId: 'room-1',
      config: { ...DEFAULT_GAME_CONFIG, rounds: 20, turnSeconds: 2 },
    })
    client.close()
  })

  it('sends revisioned commands and emits authoritative start and update events', async () => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: RecordingSocket,
    })
    const client = new NetworkClient()
    const events: unknown[] = []
    client.subscribe((event) => events.push(event))
    await client.connect('ws://localhost:5173/ws')
    const socket = RecordingSocket.instances[0]!
    socket.receive([0, PacketType.ID_ASSIGN, 7])
    const descriptor = {
      matchId: 'match-1',
      engine: { id: 'classic', revision: ENGINE_REVISION },
      config: DEFAULT_GAME_CONFIG,
      seed: 42,
      firstSeat: 0,
      revision: 0,
      turnTimeRemainingMs: 10_000,
    }
    socket.receive([0, PacketType.GAME_START, 7, descriptor])
    expect(events).toContainEqual({
      type: 'game-start',
      firstPlayerId: 7,
      descriptor,
    })

    client.sendGameCommand({
      matchId: 'match-1',
      commandId: 0,
      expectedRevision: 0,
      command: { type: 'place', locationId: 0, symbol: 'paper' },
    })
    expect(socket.sent.at(-1)).toEqual([
      7,
      PacketType.GAME_COMMAND,
      {
        matchId: 'match-1',
        commandId: 0,
        expectedRevision: 0,
        command: { type: 'place', locationId: 0, symbol: 'paper' },
      },
    ])

    const rejection = {
      status: 'rejected',
      matchId: 'match-1',
      commandId: 0,
      currentRevision: 0,
      reason: 'location-occupied',
    }
    socket.receive([0, PacketType.GAME_UPDATE, rejection])
    expect(events).toContainEqual({ type: 'game-update', update: rejection })
    expect(socket.readyState).toBe(RecordingSocket.OPEN)
    client.close()
  })

  it('emits sync-lost without closing when an authoritative packet is malformed', async () => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: RecordingSocket,
    })
    const client = new NetworkClient()
    const events: unknown[] = []
    client.subscribe((event) => events.push(event))
    await client.connect('ws://localhost:5173/ws')
    const socket = RecordingSocket.instances[0]!
    socket.receive([0, PacketType.GAME_UPDATE, {
      status: 'accepted',
      matchId: 'match-1',
      commandId: null,
      fromRevision: 0,
      toRevision: 3,
      actorSeat: 9,
      commands: [],
      events: [],
      turnTimeRemainingMs: 10_000,
    }])

    expect(events).toContainEqual({
      type: 'sync-lost',
      message: 'The server sent an update this client cannot safely apply.',
    })
    expect(socket.readyState).toBe(RecordingSocket.OPEN)
    client.close()
  })

  it('does not surface legacy gameplay relays into the authoritative online flow', async () => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: RecordingSocket,
    })
    const client = new NetworkClient()
    const events: unknown[] = []
    client.subscribe((event) => events.push(event))
    await client.connect('ws://localhost:5173/ws')
    const socket = RecordingSocket.instances[0]!
    socket.receive([9, PacketType.GAME_MOVE, 0, 'green'])
    socket.receive([9, PacketType.GAME_MOVES, [0, 1], ['green', 'blue']])
    socket.receive([9, PacketType.IMMUNE_UPDATE, [0]])

    expect(events).toEqual([{ type: 'open' }])
    expect(socket.readyState).toBe(RecordingSocket.OPEN)
    client.close()
  })
})
