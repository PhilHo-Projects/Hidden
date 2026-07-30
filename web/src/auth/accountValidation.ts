export type AccountMode = 'register' | 'login'

/**
 * Mirrors the server bounds in `server/src/auth/password.ts`. The form's own
 * `minLength` must not be stricter, or the browser blocks a password the server
 * would have accepted and the user never sees why.
 */
export const MIN_PASSWORD_CHARACTERS = 8
export const MAX_PASSWORD_CHARACTERS = 128

export function validateAccountSubmission(
  mode: AccountMode,
  password: string,
  confirmation: string,
) {
  if (mode === 'register' && password !== confirmation) {
    return 'Passwords do not match.'
  }
  return null
}
