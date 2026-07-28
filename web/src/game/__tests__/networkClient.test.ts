import { afterEach, describe, expect, it } from 'vitest'
import { NetworkClient, resolveWebSocketUrl } from '../networkClient'

class OpenSocket {
  static OPEN = 1
  readyState = OpenSocket.OPEN
  send() {}
}

const originalWebSocket = globalThis.WebSocket

afterEach(() => {
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
})
