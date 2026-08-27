export function resolveTurnstileSiteKey(
  value: string | undefined,
  production: boolean,
) {
  const normalized = value?.trim() ?? ''
  if (production && !normalized) {
    throw new Error('VITE_TURNSTILE_SITE_KEY is required for production builds.')
  }
  return normalized
}
