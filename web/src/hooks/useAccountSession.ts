import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AuthApiError,
  type AccountDeviceSession,
  type AuthAccount,
  type AuthClient,
  type AuthUser,
  type RegistrationInput,
} from '../auth/authClient'
import type { AuthRedirectIntent } from '../auth/authRedirect'
import type { AccountMode } from '../auth/accountValidation'
import type { UiStatus } from '../components/PregameUi'

interface UseAccountSessionOptions {
  client: AuthClient
  guestUsername: string
  onStatusChange: (status: UiStatus) => void
  initialIntent?: AuthRedirectIntent | null
}

export interface AccountSession {
  authUser: AuthUser | null
  accountEmail: string | null
  emailVerified: boolean
  authHydrated: boolean
  authMode: AccountMode
  authBusy: boolean
  authError: string | null
  authNotice: string | null
  verificationEmail: string | null
  captchaResetKey: number
  deviceSessions: AccountDeviceSession[]
  prepareAccount: (mode: AccountMode) => Promise<void>
  registerAccount: (input: RegistrationInput) => Promise<void>
  loginAccount: (identifier: string, password: string) => Promise<AuthUser>
  requestRecovery: (email: string, captchaToken: string) => Promise<void>
  resendVerification: (captchaToken: string) => Promise<void>
  resetAccountPassword: (newPassword: string) => Promise<void>
  requestEmailChange: (newEmail: string) => Promise<void>
  changeAccountPassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>
  loadDeviceSessions: () => Promise<void>
  revokeDevice: (token: string) => Promise<void>
  signOutOtherDevices: () => Promise<void>
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
  initialIntent = null,
}: UseAccountSessionOptions): AccountSession {
  const [account, setAccount] = useState<AuthAccount | null>(null)
  const [authHydrated, setAuthHydrated] = useState(false)
  const [authMode, setAuthMode] = useState<AccountMode>(
    initialIntent?.view === 'reset'
      ? 'reset'
      : initialIntent?.view === 'verified'
        ? 'login'
        : 'register',
  )
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(
    initialIntent?.error
      ? 'That secure link is invalid or has expired.'
      : null,
  )
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [deviceSessions, setDeviceSessions] = useState<AccountDeviceSession[]>([])
  const resetTokenRef = useRef(
    initialIntent?.view === 'reset' ? initialIntent.token : undefined,
  )
  const onStatusChangeRef = useRef(onStatusChange)
  const accountRef = useRef<AuthAccount | null>(null)

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  const storeAccount = useCallback((next: AuthAccount | null) => {
    accountRef.current = next
    setAccount(next)
  }, [])

  useEffect(() => {
    let active = true
    void client
      .getSession()
      .then((restored) => {
        if (!active) return
        storeAccount(restored)
        if (restored) {
          const verified = initialIntent?.view === 'verified' && !initialIntent.error
          if (verified) setAuthNotice('Email verified. Your account is ready.')
          onStatusChangeRef.current({
            tone: 'success',
            label: 'ACCOUNT',
            detail: `Signed in as ${restored.user.username}.`,
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
  }, [client, initialIntent, storeAccount])

  const fail = useCallback((cause: unknown, label = 'ACCOUNT ERROR') => {
    const message = accountErrorMessage(cause)
    if (cause instanceof AuthApiError && cause.code === 'session_expired') {
      storeAccount(null)
      setDeviceSessions([])
      setAuthMode('login')
    }
    setAuthError(message)
    setAuthNotice(null)
    onStatusChangeRef.current({ tone: 'error', label, detail: message })
    return message
  }, [storeAccount])

  const loadDeviceSessions = useCallback(async () => {
    const current = accountRef.current
    if (!current) return
    try {
      setDeviceSessions(await client.listSessions(current.currentSessionId))
    } catch (cause) {
      fail(cause, 'SESSION ERROR')
    }
  }, [client, fail])

  const prepareAccount = useCallback(async (mode: AccountMode) => {
    setAuthMode(mode)
    setAuthError(null)
    setAuthNotice(null)
    onStatusChangeRef.current({
      tone: 'neutral',
      label: 'ACCOUNT',
      detail: mode === 'register'
        ? 'Create a verified player account.'
        : mode === 'login'
          ? 'Return to your account.'
          : mode === 'settings'
            ? 'Manage your private account details.'
            : 'Complete your account action.',
    })
    if (mode === 'settings') await loadDeviceSessions()
  }, [loadDeviceSessions])

  const registerAccount = useCallback(async (input: RegistrationInput) => {
    setAuthBusy(true)
    setAuthError(null)
    setAuthNotice(null)
    try {
      const result = await client.register(input)
      setVerificationEmail(result.email)
      setAuthMode('verify')
      setAuthNotice('Check your email to verify the account, then return here.')
    } catch (cause) {
      fail(cause)
      throw cause
    } finally {
      setCaptchaResetKey((value) => value + 1)
      setAuthBusy(false)
    }
  }, [client, fail])

  const loginAccount = useCallback(async (
    identifier: string,
    password: string,
  ) => {
    setAuthBusy(true)
    setAuthError(null)
    setAuthNotice(null)
    try {
      const restored = await client.login(identifier, password)
      storeAccount(restored)
      onStatusChangeRef.current({
        tone: 'success',
        label: 'ACCOUNT',
        detail: `Signed in as ${restored.user.username}.`,
      })
      return restored.user
    } catch (cause) {
      fail(cause)
      throw cause
    } finally {
      setAuthBusy(false)
    }
  }, [client, fail, storeAccount])

  const requestRecovery = useCallback(async (
    email: string,
    captchaToken: string,
  ) => {
    setAuthBusy(true)
    setAuthError(null)
    setAuthNotice(null)
    try {
      await client.requestPasswordReset(email, captchaToken)
      setAuthNotice(
        'If that email belongs to an account, a reset link is on its way.',
      )
    } catch (cause) {
      fail(cause)
      throw cause
    } finally {
      setCaptchaResetKey((value) => value + 1)
      setAuthBusy(false)
    }
  }, [client, fail])

  const resendVerification = useCallback(async (captchaToken: string) => {
    if (!verificationEmail) return
    setAuthBusy(true)
    setAuthError(null)
    setAuthNotice(null)
    try {
      await client.resendVerification(verificationEmail, captchaToken)
      setAuthNotice('If verification is still needed, another email is on its way.')
    } catch (cause) {
      fail(cause)
      throw cause
    } finally {
      setCaptchaResetKey((value) => value + 1)
      setAuthBusy(false)
    }
  }, [client, fail, verificationEmail])

  const resetAccountPassword = useCallback(async (newPassword: string) => {
    const token = resetTokenRef.current
    if (!token) {
      const error = new AuthApiError(
        'invalid_token',
        'That secure link is invalid or has expired.',
      )
      fail(error)
      throw error
    }
    setAuthBusy(true)
    setAuthError(null)
    try {
      await client.resetPassword(token, newPassword)
      resetTokenRef.current = undefined
      storeAccount(null)
      setAuthMode('login')
      setAuthNotice('Password changed. Sign in again on this device.')
    } catch (cause) {
      fail(cause)
      throw cause
    } finally {
      setAuthBusy(false)
    }
  }, [client, fail, storeAccount])

  const requestEmailChange = useCallback(async (newEmail: string) => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      await client.changeEmail(newEmail)
      setAuthNotice('Check your current email, then verify the new address.')
    } catch (cause) {
      fail(cause)
      throw cause
    } finally {
      setAuthBusy(false)
    }
  }, [client, fail])

  const changeAccountPassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
  ) => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      await client.changePassword(currentPassword, newPassword)
      setDeviceSessions((sessions) => sessions.filter(({ current }) => current))
      setAuthNotice('Password changed. Other devices have been signed out.')
    } catch (cause) {
      fail(cause)
      throw cause
    } finally {
      setAuthBusy(false)
    }
  }, [client, fail])

  const revokeDevice = useCallback(async (token: string) => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      await client.revokeSession(token)
      setDeviceSessions((sessions) =>
        sessions.filter((session) => session.token !== token),
      )
      setAuthNotice('That device has been signed out.')
    } catch (cause) {
      fail(cause, 'SESSION ERROR')
      throw cause
    } finally {
      setAuthBusy(false)
    }
  }, [client, fail])

  const signOutOtherDevices = useCallback(async () => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      await client.signOutOtherSessions()
      setDeviceSessions((sessions) => sessions.filter(({ current }) => current))
      setAuthNotice('Every other device has been signed out.')
    } catch (cause) {
      fail(cause, 'SESSION ERROR')
      throw cause
    } finally {
      setAuthBusy(false)
    }
  }, [client, fail])

  const logoutAccount = useCallback(async () => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      await client.logout()
      storeAccount(null)
      setDeviceSessions([])
      onStatusChangeRef.current({
        tone: 'neutral',
        label: 'GUEST',
        detail: `Playing as ${guestUsername}.`,
      })
      return true
    } catch (cause) {
      fail(cause, 'LOGOUT ERROR')
      return false
    } finally {
      setAuthBusy(false)
    }
  }, [client, fail, guestUsername, storeAccount])

  const invalidateSession = useCallback((message?: string) => {
    storeAccount(null)
    setDeviceSessions([])
    setAuthMode('login')
    setAuthError(message ?? null)
  }, [storeAccount])

  return {
    authUser: account?.user ?? null,
    accountEmail: account?.email ?? null,
    emailVerified: account?.emailVerified ?? false,
    authHydrated,
    authMode,
    authBusy,
    authError,
    authNotice,
    verificationEmail,
    captchaResetKey,
    deviceSessions,
    prepareAccount,
    registerAccount,
    loginAccount,
    requestRecovery,
    resendVerification,
    resetAccountPassword,
    requestEmailChange,
    changeAccountPassword,
    loadDeviceSessions,
    revokeDevice,
    signOutOtherDevices,
    logoutAccount,
    invalidateSession,
  }
}
