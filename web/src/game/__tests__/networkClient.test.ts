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
      rounds: 8,
      turnSeconds: 15,
      blindMode: false,
    })
    expect(socket.sent.at(-1)).toEqual([
      7,
      PacketType.MATCHMAKING_REQUEST,
      true,
      { rounds: 8, turnSeconds: 15, blindMode: false },
    ])

    socket.receive([
      0,
      PacketType.MATCH_FOUND,
      'room-1',
      { rounds: 999, turnSeconds: 0, blindMode: false },
    ])
    expect(events).toContainEqual({
      type: 'match-found',
      roomId: 'room-1',
      rules: { rounds: 20, turnSeconds: 2, blindMode: false },
    })
    client.close()
  })
})
