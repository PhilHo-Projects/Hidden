const RESEND_EMAILS_URL = 'https://api.resend.com/emails'
const DEFAULT_EMAIL_TIMEOUT_MS = 5_000

export interface TransactionalEmailMessage {
  to: string
  url: string
}

export interface TransactionalEmail {
  sendVerification(message: TransactionalEmailMessage): Promise<void>
  sendPasswordReset(message: TransactionalEmailMessage): Promise<void>
  sendEmailChange(message: TransactionalEmailMessage): Promise<void>
}

export type TransactionalEmailOperation =
  | 'verification'
  | 'password-reset'
  | 'email-change'

export class TransactionalEmailError extends Error {
  readonly retryable = true

  constructor(readonly operation: TransactionalEmailOperation) {
    super(`Transactional email provider failed during ${operation}.`)
    this.name = 'TransactionalEmailError'
  }
}

export interface ResendTransactionalEmailOptions {
  apiKey: string
  from: string
  timeoutMs?: number
}

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

interface EmailContent {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function linkedMessage(
  heading: string,
  introduction: string,
  actionLabel: string,
  url: string,
): Omit<EmailContent, 'subject'> {
  const safeURL = escapeHtml(url)
  return {
    text: `${heading}\n\n${introduction}\n\n${actionLabel}: ${url}\n\nIf you did not request this, you can ignore this email.`,
    html: `<h1>${heading}</h1><p>${introduction}</p><p><a href="${safeURL}">${actionLabel}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  }
}

function contentFor(
  operation: TransactionalEmailOperation,
  url: string,
): EmailContent {
  switch (operation) {
    case 'verification':
      return {
        subject: 'Verify your Hidden account',
        ...linkedMessage(
          'Welcome to Hidden',
          'Verify your email to finish setting up your optional game account.',
          'Verify account',
          url,
        ),
      }
    case 'password-reset':
      return {
        subject: 'Reset your Hidden password',
        ...linkedMessage(
          'Reset your Hidden password',
          'Use this secure link to choose a new password.',
          'Reset password',
          url,
        ),
      }
    case 'email-change':
      return {
        subject: 'Confirm your Hidden email change',
        ...linkedMessage(
          'Confirm your email change',
          'Confirm that you want to change the email on your Hidden account.',
          'Confirm email change',
          url,
        ),
      }
  }
}

export class ResendTransactionalEmail implements TransactionalEmail {
  private readonly timeoutMs: number

  constructor(
    private readonly options: ResendTransactionalEmailOptions,
    private readonly fetchImpl: FetchImplementation = fetch,
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_EMAIL_TIMEOUT_MS
  }

  sendVerification(message: TransactionalEmailMessage) {
    return this.send('verification', message)
  }

  sendPasswordReset(message: TransactionalEmailMessage) {
    return this.send('password-reset', message)
  }

  sendEmailChange(message: TransactionalEmailMessage) {
    return this.send('email-change', message)
  }

  private async send(
    operation: TransactionalEmailOperation,
    message: TransactionalEmailMessage,
  ) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    timeout.unref?.()
    const content = contentFor(operation, message.url)
    try {
      const response = await this.fetchImpl(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: content.subject,
          html: content.html,
          text: content.text,
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new TransactionalEmailError(operation)
      }
      const result = (await response.json()) as unknown
      if (
        !result ||
        typeof result !== 'object' ||
        typeof (result as { id?: unknown }).id !== 'string' ||
        !(result as { id: string }).id
      ) {
        throw new TransactionalEmailError(operation)
      }
    } catch (error) {
      if (error instanceof TransactionalEmailError) {
        throw error
      }
      throw new TransactionalEmailError(operation)
    } finally {
      clearTimeout(timeout)
    }
  }
}
