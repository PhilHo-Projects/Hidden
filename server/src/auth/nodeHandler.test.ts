import {
  Agent,
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTH_BODY_LIMIT_BYTES,
  createBoundedAuthHandler,
  INTERNAL_CLIENT_IP_HEADER,
} from './nodeHandler.js'

interface ReceivedResponse {
  body: string
  headers: IncomingHttpHeaders
  reusedSocket: boolean
  status: number
}

const servers = new Set<Server>()

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  )
  servers.clear()
})

async function start(
  authHandler: (request: Request) => Promise<Response>,
) {
  const bounded = createBoundedAuthHandler({
    auth: { handler: authHandler },
    baseURL: 'https://hidden.example',
  })
  const server = createServer((request, response) => {
    Object.defineProperty(request, 'ip', {
      configurable: true,
      value: '203.0.113.9',
    })
    void bounded(request, response).catch(() => {
      response.statusCode = 500
      response.end()
    })
  })
  servers.add(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

function send(
  port: number,
  options: {
    body?: string | Buffer
    headers?: Record<string, string>
    agent?: Agent
    method?: string
    path?: string
  } = {},
) {
  return new Promise<ReceivedResponse>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path ?? '/api/auth/probe',
        method: options.method ?? 'GET',
        headers: options.headers,
        agent: options.agent,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            reusedSocket: request.reusedSocket,
          })
        })
      },
    )
    request.once('error', reject)
    request.end(options.body)
  })
}

describe('createBoundedAuthHandler', () => {
  it.each(['GET', 'HEAD'])('%s may omit Content-Type', async (method) => {
    const port = await start(async () => new Response('ok', { status: 200 }))

    const response = await send(port, { method })

    expect(response.status).toBe(200)
  })

  it.each(['GET', 'HEAD'])(
    'rejects a body-bearing %s with an unsupported Content-Type',
    async (method) => {
      let routed = false
      const port = await start(async () => {
        routed = true
        return new Response('unexpected')
      })

      const response = await send(port, {
        method,
        headers: {
          'content-type': 'text/plain',
          'content-length': '2',
        },
        body: '{}',
      })

      expect(response.status).toBe(415)
      expect(routed).toBe(false)
    },
  )

  it.each(['GET', 'HEAD'])(
    'enforces the streaming limit for a body-bearing %s',
    async (method) => {
      let routed = false
      const port = await start(async () => {
        routed = true
        return new Response('unexpected')
      })

      const response = await send(port, {
        method,
        headers: {
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
        },
        body: Buffer.alloc(AUTH_BODY_LIMIT_BYTES + 1, 0x78),
      })

      expect(response.status).toBe(413)
      expect(routed).toBe(false)
    },
  )

  it('rejects body-bearing requests that are not JSON with a stable 415 response', async () => {
    let routed = false
    const port = await start(async () => {
      routed = true
      return new Response('unexpected')
    })

    const response = await send(port, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    })

    expect(response.status).toBe(415)
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(response.body)).toEqual({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Auth requests require application/json.',
    })
    expect(routed).toBe(false)
  })

  it('accepts exactly 4096 JSON bytes and forwards the proxy-resolved IP', async () => {
    const fixedJsonBytes = Buffer.byteLength('{"value":""}')
    const body = JSON.stringify({
      value: 'x'.repeat(AUTH_BODY_LIMIT_BYTES - fixedJsonBytes),
    })
    const port = await start(async (request) =>
      Response.json({
        bytes: Buffer.byteLength(await request.text()),
        ip: request.headers.get(INTERNAL_CLIENT_IP_HEADER),
      }),
    )

    const response = await send(port, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        [INTERNAL_CLIENT_IP_HEADER]: '198.51.100.77',
      },
      body,
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      bytes: 4_096,
      ip: '203.0.113.9',
    })
  })

  it('rejects a chunked body over 4096 bytes with 413 and keeps the socket usable', async () => {
    let routed = 0
    const port = await start(async () => {
      routed += 1
      return new Response('ok')
    })
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })

    const oversized = await new Promise<ReceivedResponse>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/auth/probe',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          agent,
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
              reusedSocket: request.reusedSocket,
            }),
          )
        },
      )
      request.once('error', reject)
      request.write(Buffer.alloc(2_048, 0x78))
      request.write(Buffer.alloc(2_049, 0x78))
      request.end()
    })

    expect(oversized.status).toBe(413)
    expect(JSON.parse(oversized.body)).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Auth request body exceeds 4096 bytes.',
    })
    expect(routed).toBe(0)

    try {
      const next = await send(port, { agent })
      expect(next.status).toBe(200)
      expect(next.reusedSocket).toBe(true)
      expect(routed).toBe(1)
    } finally {
      agent.destroy()
    }
  })

  it('returns 413 immediately after a chunked body crosses 4096 bytes', async () => {
    let routed = false
    const port = await start(async () => {
      routed = true
      return new Response('unexpected')
    })
    let request: ReturnType<typeof httpRequest> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      const responsePromise = new Promise<ReceivedResponse>((resolve, reject) => {
        request = httpRequest(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/auth/probe',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
          },
          (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk: Buffer) => chunks.push(chunk))
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8'),
                reusedSocket: request?.reusedSocket ?? false,
              }),
            )
          },
        )
        request.once('error', reject)
        request.write(Buffer.alloc(AUTH_BODY_LIMIT_BYTES + 1, 0x78))
      })

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Timed out waiting for immediate 413.')),
          750,
        )
      })
      const response = await Promise.race([responsePromise, timeoutPromise])

      expect(response.status).toBe(413)
      expect(JSON.parse(response.body)).toEqual({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Auth request body exceeds 4096 bytes.',
      })
      expect(routed).toBe(false)
    } finally {
      clearTimeout(timeout)
      request?.destroy()
    }
  })

  it('preserves Better Auth status, body, headers, and multiple cookies', async () => {
    const port = await start(async () => {
      const headers = new Headers({
        'content-type': 'application/json',
        'x-auth-probe': 'preserved',
      })
      headers.append('set-cookie', 'first=one; HttpOnly; Path=/')
      headers.append('set-cookie', 'second=two; HttpOnly; Path=/')
      return new Response('{"accepted":true}', {
        status: 202,
        headers,
      })
    })

    const response = await send(port)

    expect(response).toMatchObject({
      status: 202,
      body: '{"accepted":true}',
      headers: { 'x-auth-probe': 'preserved' },
    })
    expect(response.headers['set-cookie']).toEqual([
      'first=one; HttpOnly; Path=/',
      'second=two; HttpOnly; Path=/',
    ])
  })
})
