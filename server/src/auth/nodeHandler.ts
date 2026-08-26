import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

export const AUTH_BODY_LIMIT_BYTES = 4_096
export const INTERNAL_CLIENT_IP_HEADER = 'x-hidden-client-ip'

const UNSUPPORTED_MEDIA_TYPE = {
  code: 'UNSUPPORTED_MEDIA_TYPE',
  message: 'Auth requests require application/json.',
}

const PAYLOAD_TOO_LARGE = {
  code: 'PAYLOAD_TOO_LARGE',
  message: 'Auth request body exceeds 4096 bytes.',
}

interface ExpressCompatibleRequest extends IncomingMessage {
  ip?: string
  originalUrl?: string
}

export interface BoundedAuthHandlerOptions {
  auth: {
    handler(request: Request): Promise<Response>
  }
  baseURL: string
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isJsonRequest(headers: IncomingHttpHeaders) {
  const contentType = firstHeader(headers['content-type'])
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

function copyHeaders(headers: IncomingHttpHeaders) {
  const result = new Headers()
  for (const [name, rawValue] of Object.entries(headers)) {
    if (
      rawValue === undefined ||
      name.toLowerCase() === INTERNAL_CLIENT_IP_HEADER
    ) {
      continue
    }
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        result.append(name, value)
      }
    } else {
      result.set(name, rawValue)
    }
  }
  return result
}

async function readBoundedBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let received = 0
  let tooLarge = false
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array)
    received += chunk.byteLength
    if (received > AUTH_BODY_LIMIT_BYTES) {
      tooLarge = true
      chunks.length = 0
      continue
    }
    if (!tooLarge) {
      chunks.push(chunk)
    }
  }
  return tooLarge ? undefined : Buffer.concat(chunks, received)
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, string>,
) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

async function sendWebResponse(
  nodeResponse: ServerResponse,
  webResponse: Response,
) {
  for (const [name, value] of webResponse.headers) {
    if (name.toLowerCase() !== 'set-cookie') {
      nodeResponse.setHeader(name, value)
    }
  }
  const cookies = webResponse.headers.getSetCookie()
  if (cookies.length > 0) {
    nodeResponse.setHeader('set-cookie', cookies)
  }
  nodeResponse.statusCode = webResponse.status
  if (!webResponse.body) {
    nodeResponse.end()
    return
  }
  nodeResponse.end(Buffer.from(await webResponse.arrayBuffer()))
}

export function createBoundedAuthHandler(
  options: BoundedAuthHandlerOptions,
) {
  return async (
    request: ExpressCompatibleRequest,
    response: ServerResponse,
  ): Promise<void> => {
    const method = request.method?.toUpperCase() ?? 'GET'
    const mayOmitContentType = method === 'GET' || method === 'HEAD'
    if (!mayOmitContentType && !isJsonRequest(request.headers)) {
      request.resume()
      sendJson(response, 415, UNSUPPORTED_MEDIA_TYPE)
      return
    }

    const body = mayOmitContentType ? undefined : await readBoundedBody(request)
    if (!mayOmitContentType && body === undefined) {
      sendJson(response, 413, PAYLOAD_TOO_LARGE)
      return
    }

    const headers = copyHeaders(request.headers)
    const resolvedIP = request.ip ?? request.socket.remoteAddress
    if (resolvedIP) {
      headers.set(INTERNAL_CLIENT_IP_HEADER, resolvedIP)
    }
    const path = request.originalUrl ?? request.url ?? '/'
    const webRequest = new Request(new URL(path, options.baseURL), {
      method,
      headers,
      ...(body ? { body: body.toString('utf8') } : {}),
    })
    const webResponse = await options.auth.handler(webRequest)
    await sendWebResponse(response, webResponse)
  }
}
