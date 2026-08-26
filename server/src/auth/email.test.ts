import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ResendTransactionalEmail,
  TransactionalEmailError,
} from './email.js'

const URL_WITH_TOKEN =
  'https://hidden.example/api/auth/verify-email?token=top-secret-token&callbackURL=%2F'

describe('ResendTransactionalEmail', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['sendVerification', 'Verify your Hidden account', 'Verify account'],
    ['sendPasswordReset', 'Reset your Hidden password', 'Reset password'],
    ['sendEmailChange', 'Confirm your Hidden email change', 'Confirm email change'],
  ] as const)(
    'sends separate HTML and text content through Resend for %s',
    async (operation, subject, actionLabel) => {
      const requests: Array<{ input: string; init?: RequestInit }> = []
      const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ input: String(input), ...(init ? { init } : {}) })
        return new Response(JSON.stringify({ id: 'email_123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const email = new ResendTransactionalEmail(
        {
          apiKey: 're_test_only',
          from: 'Hidden <no-reply@hidden.example>',
        },
        fetchImpl,
      )

      await email[operation]({
        to: 'player@example.com',
        url: URL_WITH_TOKEN,
      })

      expect(requests).toHaveLength(1)
      expect(requests[0]?.input).toBe('https://api.resend.com/emails')
      expect(requests[0]?.init).toMatchObject({
        method: 'POST',
        headers: {
          authorization: 'Bearer re_test_only',
          'content-type': 'application/json',
        },
      })
      const payload = JSON.parse(String(requests[0]?.init?.body)) as Record<
        string,
        unknown
      >
      expect(payload).toMatchObject({
        from: 'Hidden <no-reply@hidden.example>',
        to: ['player@example.com'],
        subject,
      })
      expect(payload.text).toContain(actionLabel)
      expect(payload.text).toContain(URL_WITH_TOKEN)
      expect(payload.html).toContain(actionLabel)
      expect(payload.html).toContain(URL_WITH_TOKEN.replaceAll('&', '&amp;'))
    },
  )

  it.each([
    new Response('provider unavailable', { status: 503 }),
    new Response('{"unexpected":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    new Response('not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ])('turns non-success and invalid provider responses into safe errors', async (response) => {
    const email = new ResendTransactionalEmail(
      {
        apiKey: 're_test_only',
        from: 'Hidden <no-reply@hidden.example>',
      },
      async () => response,
    )

    const error = await email
      .sendVerification({ to: 'private@example.com', url: URL_WITH_TOKEN })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TransactionalEmailError)
    expect(error).toMatchObject({ operation: 'verification' })
    expect(String(error)).not.toContain('private@example.com')
    expect(String(error)).not.toContain('top-secret-token')
    expect(String(error)).not.toContain(URL_WITH_TOKEN)
    expect(String(error)).not.toContain('provider unavailable')
  })

  it('aborts a provider request at the bounded timeout with a safe retryable error', async () => {
    vi.useFakeTimers()
    const fetchImpl = (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error(`leaked ${URL_WITH_TOKEN}`)),
        )
      })
    const email = new ResendTransactionalEmail(
      {
        apiKey: 're_test_only',
        from: 'Hidden <no-reply@hidden.example>',
        timeoutMs: 250,
      },
      fetchImpl,
    )

    const sending = email.sendPasswordReset({
      to: 'private@example.com',
      url: URL_WITH_TOKEN,
    })
    const settled = sending.catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(250)
    const error = await settled

    expect(error).toBeInstanceOf(TransactionalEmailError)
    expect(error).toMatchObject({
      operation: 'password-reset',
      retryable: true,
    })
    expect(String(error)).not.toContain('private@example.com')
    expect(String(error)).not.toContain('top-secret-token')
  })
})
