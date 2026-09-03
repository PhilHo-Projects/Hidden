export type AuthRedirectIntent =
  | { view: 'reset'; token?: string; error?: string }
  | { view: 'verified'; error?: string }

export function consumeAuthRedirect(
  source: URL,
  replace: (sanitizedPath: string) => void,
): AuthRedirectIntent | null {
  const auth = source.searchParams.get('auth')
  if (auth !== 'reset-password' && auth !== 'verified') {
    return null
  }

  const token = source.searchParams.get('token') || undefined
  const error = source.searchParams.get('error') || undefined
  source.searchParams.delete('auth')
  source.searchParams.delete('token')
  source.searchParams.delete('error')
  const query = source.searchParams.toString()
  replace(`${source.pathname}${query ? `?${query}` : ''}${source.hash}`)

  return auth === 'reset-password'
    ? {
        view: 'reset',
        ...(token ? { token } : {}),
        ...(error ? { error } : {}),
      }
    : {
        view: 'verified',
        ...(error ? { error } : {}),
      }
}
