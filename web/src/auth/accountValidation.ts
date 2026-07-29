export type AccountMode = 'register' | 'login'

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
