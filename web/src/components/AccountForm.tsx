import { useState, type FormEvent } from 'react'
import {
  MAX_PASSWORD_CHARACTERS,
  MIN_PASSWORD_CHARACTERS,
  validateAccountSubmission,
  type AccountMode,
} from '../auth/accountValidation'
import type {
  AccountDeviceSession,
  RegistrationInput,
} from '../auth/authClient'
import { TurnstileWidget, type TurnstileApi } from './TurnstileWidget'

interface AccountFormProps {
  mode: AccountMode
  busy: boolean
  error: string | null
  notice: string | null
  accountEmail: string | null
  verificationEmail: string | null
  captchaResetKey: number
  deviceSessions: AccountDeviceSession[]
  turnstileSiteKey: string
  turnstileApi?: TurnstileApi
  onModeChange(mode: AccountMode): Promise<void>
  onRegister(input: RegistrationInput): Promise<void>
  onLogin(identifier: string, password: string): Promise<void>
  onRequestRecovery(email: string, captchaToken: string): Promise<void>
  onResendVerification(captchaToken: string): Promise<void>
  onResetPassword(newPassword: string): Promise<void>
  onChangeEmail(newEmail: string): Promise<void>
  onChangePassword(currentPassword: string, newPassword: string): Promise<void>
  onRevokeDevice(token: string): Promise<void>
  onSignOutOtherDevices(): Promise<void>
}

function PasswordField({
  name,
  label,
  value,
  autoComplete,
  busy,
  onChange,
}: {
  name: string
  label: string
  value: string
  autoComplete: string
  busy: boolean
  onChange(value: string): void
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        name={name}
        type="password"
        value={value}
        minLength={MIN_PASSWORD_CHARACTERS}
        maxLength={MAX_PASSWORD_CHARACTERS}
        autoComplete={autoComplete}
        required
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? (
        <p className="account-form-error" role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="account-form-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </>
  )
}

function SubmitButton({ busy, children }: { busy: boolean; children: string }) {
  return (
    <button
      className="brush-button brush-button-yellow account-submit"
      type="submit"
      disabled={busy}
    >
      <span>{busy ? 'WORKING...' : children}</span>
    </button>
  )
}

export function AccountForm(props: AccountFormProps) {
  const {
    mode,
    busy,
    error,
    notice,
    accountEmail,
    verificationEmail,
    captchaResetKey,
    deviceSessions,
    turnstileSiteKey,
    turnstileApi,
  } = props
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const visibleError = localError ?? error

  function clearSensitiveFields() {
    setPassword('')
    setConfirmation('')
    setCurrentPassword('')
    setCaptchaToken(null)
    setLocalError(null)
  }

  async function switchMode(nextMode: AccountMode) {
    clearSensitiveFields()
    await props.onModeChange(nextMode)
  }

  function requireCaptcha() {
    if (captchaToken) return captchaToken
    setLocalError('Complete the bot check before continuing.')
    return undefined
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateAccountSubmission('register', password, confirmation)
    const token = requireCaptcha()
    if (validationError || !token) {
      if (validationError) setLocalError(validationError)
      return
    }
    setLocalError(null)
    try {
      await props.onRegister({ username, email, password, captchaToken: token })
      clearSensitiveFields()
    } catch {
      setPassword('')
      setConfirmation('')
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)
    try {
      await props.onLogin(identifier, password)
      setPassword('')
    } catch {
      setPassword('')
    }
  }

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = requireCaptcha()
    if (!token) return
    setLocalError(null)
    try {
      await props.onRequestRecovery(email, token)
    } catch {
      // The parent exposes stable, accessible copy.
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateAccountSubmission('reset', password, confirmation)
    if (validationError) {
      setLocalError(validationError)
      return
    }
    setLocalError(null)
    try {
      await props.onResetPassword(password)
      clearSensitiveFields()
    } catch {
      setPassword('')
      setConfirmation('')
    }
  }

  async function submitEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await props.onChangeEmail(newEmail)
      setNewEmail('')
    } catch {
      // The parent exposes stable, accessible copy.
    }
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmation) {
      setLocalError('Passwords do not match.')
      return
    }
    setLocalError(null)
    try {
      await props.onChangePassword(currentPassword, password)
      clearSensitiveFields()
    } catch {
      setPassword('')
      setConfirmation('')
    }
  }

  const captcha = (
    <TurnstileWidget
      siteKey={turnstileSiteKey}
      resetKey={captchaResetKey}
      onTokenChange={setCaptchaToken}
      {...(turnstileApi ? { api: turnstileApi } : {})}
    />
  )

  if (mode === 'settings') {
    return (
      <section className="account-form account-settings" aria-busy={busy}>
        <header className="account-form-heading">
          <p>Private account</p>
          <h2>Account settings</h2>
        </header>

        <section className="account-settings-section">
          <h3>Email</h3>
          <p className="account-private-value">{accountEmail}</p>
          <form
            className="account-settings-form"
            onSubmit={(event) => void submitEmailChange(event)}
          >
            <div className="account-fields">
              <label>
                <span>New verified email</span>
                <input
                  name="new-email"
                  type="email"
                  value={newEmail}
                  autoComplete="email"
                  required
                  disabled={busy}
                  onChange={(event) => setNewEmail(event.target.value)}
                />
              </label>
            </div>
            <button className="account-inline-action" type="submit" disabled={busy}>
              VERIFY NEW EMAIL
            </button>
          </form>
        </section>

        <section className="account-settings-section">
          <h3>Password</h3>
          <form
            className="account-settings-form"
            onSubmit={(event) => void submitPasswordChange(event)}
          >
            <div className="account-fields account-fields-compact">
              <PasswordField
                name="current-password"
                label="Current password"
                value={currentPassword}
                autoComplete="current-password"
                busy={busy}
                onChange={setCurrentPassword}
              />
              <PasswordField
                name="new-password"
                label="New password"
                value={password}
                autoComplete="new-password"
                busy={busy}
                onChange={setPassword}
              />
              <PasswordField
                name="new-password-confirmation"
                label="Confirm new password"
                value={confirmation}
                autoComplete="new-password"
                busy={busy}
                onChange={setConfirmation}
              />
            </div>
            <button className="account-inline-action" type="submit" disabled={busy}>
              CHANGE PASSWORD + SIGN OUT OTHERS
            </button>
          </form>
        </section>

        <section className="account-settings-section">
          <div className="account-settings-title-row">
            <h3>Devices</h3>
            <button
              className="account-text-action"
              type="button"
              disabled={busy}
              onClick={() => void props.onSignOutOtherDevices().catch(() => undefined)}
            >
              SIGN OUT OTHER DEVICES
            </button>
          </div>
          {deviceSessions.length ? (
            <ul className="account-device-list">
              {deviceSessions.map((session) => (
                <li key={session.id}>
                  <span>
                    <strong>{session.current ? 'This device' : session.userAgent || 'Unknown device'}</strong>
                    <small>
                      {session.ipAddress ? `${session.ipAddress} · ` : ''}
                      active {session.updatedAt.toLocaleString()}
                    </small>
                  </span>
                  {!session.current ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void props.onRevokeDevice(session.token).catch(() => undefined)}
                    >
                      REVOKE
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="account-recovery-note">No other active devices.</p>
          )}
        </section>
        <Feedback error={visibleError} notice={notice} />
      </section>
    )
  }

  if (mode === 'verify') {
    return (
      <section className="account-form" aria-busy={busy}>
        <header className="account-form-heading">
          <p>One last step</p>
          <h2>Check your inbox</h2>
        </header>
        <p className="account-recovery-note">
          We sent a one-hour verification link to{' '}
          <strong>{verificationEmail}</strong>. The account will not sign in until
          that address is verified.
        </p>
        {captcha}
        <Feedback error={visibleError} notice={notice} />
        <button
          className="brush-button brush-button-yellow account-submit"
          type="button"
          disabled={busy}
          onClick={() => {
            const token = requireCaptcha()
            if (token) {
              void props.onResendVerification(token).catch(() => undefined)
            }
          }}
        >
          <span>{busy ? 'WORKING...' : 'RESEND EMAIL'}</span>
        </button>
        <button className="account-mode-switch" type="button" onClick={() => void switchMode('login')}>
          Already verified? Log in
        </button>
      </section>
    )
  }

  if (mode === 'forgot') {
    return (
      <form className="account-form" aria-busy={busy} onSubmit={(event) => void submitRecovery(event)}>
        <header className="account-form-heading">
          <p>Password recovery</p>
          <h2>Find your account</h2>
        </header>
        <p className="account-recovery-note">
          If the address belongs to an account, we will send a one-hour reset link.
        </p>
        <div className="account-fields">
          <label>
            <span>Email</span>
            <input name="email" type="email" value={email} autoComplete="email" required disabled={busy} onChange={(event) => setEmail(event.target.value)} />
          </label>
        </div>
        {captcha}
        <Feedback error={visibleError} notice={notice} />
        <SubmitButton busy={busy}>SEND RESET LINK</SubmitButton>
        <button className="account-mode-switch" type="button" onClick={() => void switchMode('login')}>
          Back to login
        </button>
      </form>
    )
  }

  if (mode === 'reset') {
    return (
      <form className="account-form" aria-busy={busy} onSubmit={(event) => void submitReset(event)}>
        <header className="account-form-heading">
          <p>Secure reset</p>
          <h2>Choose a new password</h2>
        </header>
        <div className="account-fields">
          <PasswordField name="new-password" label="New password" value={password} autoComplete="new-password" busy={busy} onChange={setPassword} />
          <PasswordField name="password-confirmation" label="Confirm password" value={confirmation} autoComplete="new-password" busy={busy} onChange={setConfirmation} />
        </div>
        <Feedback error={visibleError} notice={notice} />
        <SubmitButton busy={busy}>RESET PASSWORD</SubmitButton>
        <button className="account-mode-switch" type="button" onClick={() => void switchMode('forgot')}>
          Request a new link
        </button>
      </form>
    )
  }

  const registering = mode === 'register'
  return (
    <form
      className="account-form"
      aria-busy={busy}
      onSubmit={(event) => void (registering
        ? submitRegistration(event)
        : submitLogin(event))}
    >
      <header className="account-form-heading">
        <p>{registering ? 'Create account' : 'Welcome back'}</p>
        <h2>{registering ? 'Claim your name' : 'Log in'}</h2>
      </header>
      <div className="account-fields">
        {registering ? (
          <>
            <label>
              <span>Username</span>
              <input name="username" value={username} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" value={email} autoComplete="email" autoCapitalize="none" spellCheck={false} required disabled={busy} onChange={(event) => setEmail(event.target.value)} />
            </label>
          </>
        ) : (
          <label>
            <span>Username or email</span>
            <input name="identifier" value={identifier} autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy} onChange={(event) => setIdentifier(event.target.value)} />
          </label>
        )}
        <PasswordField name="password" label="Password" value={password} autoComplete={registering ? 'new-password' : 'current-password'} busy={busy} onChange={setPassword} />
        {registering ? (
          <PasswordField name="password-confirmation" label="Confirm password" value={confirmation} autoComplete="new-password" busy={busy} onChange={setConfirmation} />
        ) : null}
      </div>
      {registering ? (
        <>
          <p className="account-recovery-note">
            Eight characters minimum. We also check breached passwords and ask you to verify your email.
          </p>
          {captcha}
        </>
      ) : null}
      <Feedback error={visibleError} notice={notice} />
      <SubmitButton busy={busy}>{registering ? 'CREATE ACCOUNT' : 'LOG IN'}</SubmitButton>
      {!registering ? (
        <button className="account-mode-switch" type="button" disabled={busy} onClick={() => void switchMode('forgot')}>
          Forgot password?
        </button>
      ) : null}
      <button className="account-mode-switch" type="button" disabled={busy} onClick={() => void switchMode(registering ? 'login' : 'register')}>
        {registering ? 'Already have an account? Log in' : 'Need an account? Create one'}
      </button>
    </form>
  )
}
