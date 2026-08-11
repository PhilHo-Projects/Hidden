import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AuthApiError,
  type AuthClient,
  type AuthUser,
} from '../auth/authClient'
import type { AccountMode } from '../auth/accountValidation'
import type { UiStatus } from '../components/PregameUi'

interface UseAccountSessionOptions {
  client: AuthClient
  guestUsername: string
  onStatusChange: (status: UiStatus) => void
}

export interface AccountSession {
  authUser: AuthUser | null
  authHydrated: boolean
  authMode: AccountMode
  authBusy: boolean
  authError: string | null
  prepareAccount: (mode: AccountMode) => void
  submitAccount: (username: string, password: string) => Promise<AuthUser>
  logoutAccount: () => Promise<boolean>
  invalidateSession: (message?: string) => void
}

function accountErrorMessage(cause: unknown) {
  return cause instanceof AuthApiError
    ? cause.message
    : 'Accounts are temporarily unavailable.'
}

export function useAccountSession({
  client,
  guestUsername,
  onStatusChange,
}: UseAccountSessionOptions): AccountSession {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authHydrated, setAuthHydrated] = useState(false)
  const [authMode, setAuthMode] = useState<AccountMode>('register')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const onStatusChangeRef = useRef(onStatusChange)

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    let active = true

    void client
      .getSession()
      .then((user) => {
        if (!active) return
        setAuthUser(user)
        if (user) {
          onStatusChangeRef.current({
            tone: 'success',
            label: 'ACCOUNT',
            detail: `Signed in as ${user.username}.`,
          })
        }
      })
      .catch(() => {
        // Account availability must never block guest or offline play.
      })
      .finally(() => {
        if (active) setAuthHydrated(true)
      })

    return () => {
      active = false
    }
  }, [client])

  const prepareAccount = useCallback((mode: AccountMode) => {
    setAuthMode(mode)
    setAuthError(null)
    onStatusChange({
      tone: 'neutral',
      label: 'ACCOUNT',
      detail: mode === 'register'
        ? 'Create a permanent player name.'
        : 'Return to your account.',
    })
  }, [onStatusChange])

  const submitAccount = useCallback(async (
    submittedUsername: string,
    password: string,
  ) => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      const user = authMode === 'register'
        ? await client.register(submittedUsername, password)
        : await client.login(submittedUsername, password)
      setAuthUser(user)
      onStatusChange({
        tone: 'success',
        label: 'ACCOUNT',
        detail: `Signed in as ${user.username}.`,
      })
      return user
    } catch (cause) {
      const message = accountErrorMessage(cause)
      setAuthError(message)
      onStatusChange({
        tone: 'error',
        label: 'ACCOUNT ERROR',
        detail: message,
      })
      throw cause
    } finally {
      setAuthBusy(false)
    }
  }, [authMode, client, onStatusChange])

  const logoutAccount = useCallback(async () => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      await client.logout()
      setAuthUser(null)
      onStatusChange({
        tone: 'neutral',
        label: 'GUEST',
        detail: `Playing as ${guestUsername}.`,
      })
      return true
    } catch (cause) {
      const message = accountErrorMessage(cause)
      setAuthError(message)
      onStatusChange({
        tone: 'error',
        label: 'LOGOUT ERROR',
        detail: message,
      })
      return false
    } finally {
      setAuthBusy(false)
    }
  }, [client, guestUsername, onStatusChange])

  const invalidateSession = useCallback((message?: string) => {
    setAuthUser(null)
    setAuthMode('login')
    setAuthError(message ?? null)
  }, [])

  return {
    authUser,
    authHydrated,
    authMode,
    authBusy,
    authError,
    prepareAccount,
    submitAccount,
    logoutAccount,
    invalidateSession,
  }
}
