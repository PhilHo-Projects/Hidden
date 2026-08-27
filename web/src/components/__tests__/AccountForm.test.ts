import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { validateAccountSubmission } from '../../auth/accountValidation'
import type { AccountDeviceSession } from '../../auth/authClient'
import { AccountForm } from '../AccountForm'

const OTHER_DEVICE: AccountDeviceSession = {
  id: '00000000-0000-4000-8000-000000000022',
  token: 'never-render-this-token',
  current: false,
  createdAt: new Date('2030-01-01T00:00:00.000Z'),
  updatedAt: new Date('2030-01-02T00:00:00.000Z'),
  expiresAt: new Date('2030-02-01T00:00:00.000Z'),
  userAgent: 'Firefox on Windows',
  ipAddress: '203.0.113.4',
}

function render(mode: Parameters<typeof AccountForm>[0]['mode']) {
  return renderToStaticMarkup(createElement(AccountForm, {
    mode,
    busy: false,
    error: null,
    notice: null,
    accountEmail: mode === 'settings' ? 'private@example.test' : null,
    verificationEmail: mode === 'verify' ? 'private@example.test' : null,
    captchaResetKey: 0,
    deviceSessions: mode === 'settings' ? [OTHER_DEVICE] : [],
    turnstileSiteKey: 'site-key',
    onModeChange: async () => undefined,
    onRegister: async () => undefined,
    onLogin: async () => undefined,
    onRequestRecovery: async () => undefined,
    onResendVerification: async () => undefined,
    onResetPassword: async () => undefined,
    onChangeEmail: async () => undefined,
    onChangePassword: async () => undefined,
    onRevokeDevice: async () => undefined,
    onSignOutOtherDevices: async () => undefined,
  }))
}

describe('AccountForm', () => {
  it('renders verified registration fields with the deliberate eight-character bound', () => {
    const markup = render('register')

    expect(markup).toContain('Claim your name')
    expect(markup).toContain('name="username"')
    expect(markup).toContain('name="email"')
    expect(markup).toContain('type="email"')
    expect(markup).toContain('Confirm password')
    expect(markup.match(/minLength="8"/g)).toHaveLength(2)
    expect(markup).toContain('Bot verification')
    expect(markup).toContain('verify your email')
  })

  it('supports username-or-email login and password recovery without a bot check on login', () => {
    const markup = render('login')

    expect(markup).toContain('Username or email')
    expect(markup).toContain('autoComplete="username"')
    expect(markup).toContain('Forgot password?')
    expect(markup).not.toContain('Bot verification')
    expect(markup).not.toContain('Confirm password')
  })

  it('renders verification resend, recovery, and reset as distinct states', () => {
    const verification = render('verify')
    const recovery = render('forgot')
    const reset = render('reset')

    expect(verification).toContain('Check your inbox')
    expect(verification).toContain('private@example.test')
    expect(verification).toContain('RESEND EMAIL')
    expect(recovery).toContain('Find your account')
    expect(recovery).toContain('If the address belongs to an account')
    expect(reset).toContain('Choose a new password')
    expect(reset).toContain('Confirm password')
  })

  it('keeps email and session details inside settings and never renders session tokens', () => {
    const settings = render('settings')
    const login = render('login')

    expect(settings).toContain('Account settings')
    expect(settings).toContain('private@example.test')
    expect(settings).toContain('Firefox on Windows')
    expect(settings).toContain('REVOKE')
    expect(settings).toContain('SIGN OUT OTHER DEVICES')
    expect(settings).not.toContain('never-render-this-token')
    expect(login).not.toContain('private@example.test')
  })

  it('announces server errors and status copy accessibly', () => {
    const markup = renderToStaticMarkup(createElement(AccountForm, {
      ...{
        mode: 'login' as const,
        busy: true,
        error: 'Username/email or password is incorrect.',
        notice: 'Try again.',
        accountEmail: null,
        verificationEmail: null,
        captchaResetKey: 0,
        deviceSessions: [],
        turnstileSiteKey: 'site-key',
        onModeChange: async () => undefined,
        onRegister: async () => undefined,
        onLogin: async () => undefined,
        onRequestRecovery: async () => undefined,
        onResendVerification: async () => undefined,
        onResetPassword: async () => undefined,
        onChangeEmail: async () => undefined,
        onChangePassword: async () => undefined,
        onRevokeDevice: async () => undefined,
        onSignOutOtherDevices: async () => undefined,
      },
    }))

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-busy="true"')
  })

  it('blocks mismatched registration and reset passwords without stricter composition rules', () => {
    expect(validateAccountSubmission('register', '12345678', '1234567')).toBe(
      'Passwords do not match.',
    )
    expect(validateAccountSubmission('reset', '12345678', 'abcdefgh')).toBe(
      'Passwords do not match.',
    )
    expect(validateAccountSubmission('login', '12345678', '')).toBeNull()
  })
})
