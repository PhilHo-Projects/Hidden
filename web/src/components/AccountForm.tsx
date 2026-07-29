import {
  useState,
  type FormEvent,
} from 'react'
import {
  validateAccountSubmission,
  type AccountMode,
} from '../auth/accountValidation'

interface AccountFormProps {
  mode: AccountMode
  busy: boolean
  error: string | null
  onModeChange: (mode: AccountMode) => void
  onSubmit: (username: string, password: string) => Promise<void>
}

export function AccountForm({
  mode,
  busy,
  error,
  onModeChange,
  onSubmit,
}: AccountFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const isRegistering = mode === 'register'
  const visibleError = localError ?? error

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateAccountSubmission(
      mode,
      password,
      confirmation,
    )
    if (validationError) {
      setLocalError(validationError)
      return
    }

    setLocalError(null)
    try {
      await onSubmit(username, password)
    } catch {
      setPassword('')
      setConfirmation('')
    }
  }

  function switchMode(nextMode: AccountMode) {
    setPassword('')
    setConfirmation('')
    setLocalError(null)
    onModeChange(nextMode)
  }

  return (
    <form
      className="account-form"
      aria-busy={busy}
      onSubmit={(event) => void submit(event)}
    >
      <header className="account-form-heading">
        <p>{isRegistering ? 'Create account' : 'Welcome back'}</p>
        <h2>{isRegistering ? 'Claim your name' : 'Log in'}</h2>
      </header>

      <div className="account-fields">
        <label>
          <span>Username</span>
          <input
            name="username"
            value={username}
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9_]+"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={busy}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label>
          <span>Password</span>
          <input
            name="password"
            type="password"
            value={password}
            minLength={10}
            maxLength={128}
            autoComplete={isRegistering ? 'new-password' : 'current-password'}
            required
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {isRegistering ? (
          <label>
            <span>Confirm password</span>
            <input
              name="password-confirmation"
              type="password"
              value={confirmation}
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              required
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      {isRegistering ? (
        <p className="account-recovery-note">
          No password recovery in this first release. Save it somewhere safe.
        </p>
      ) : null}

      {visibleError ? (
        <p className="account-form-error" role="alert">
          {visibleError}
        </p>
      ) : null}

      <button
        className="brush-button brush-button-yellow account-submit"
        type="submit"
        disabled={busy}
      >
        <span>
          {busy
            ? 'WORKING...'
            : isRegistering
              ? 'CREATE ACCOUNT'
              : 'LOG IN'}
        </span>
      </button>

      <button
        className="account-mode-switch"
        type="button"
        disabled={busy}
        onClick={() => switchMode(isRegistering ? 'login' : 'register')}
      >
        {isRegistering
          ? 'Already have an account? Log in'
          : 'Need an account? Create one'}
      </button>
    </form>
  )
}
