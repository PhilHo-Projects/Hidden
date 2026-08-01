export function resolveDatabaseUrl(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
) {
  const normalized = databaseUrl?.trim()
  if (normalized) {
    return normalized
  }
  if (nodeEnv === 'production') {
    throw new Error('DATABASE_URL is required in production.')
  }
  return undefined
}

const LOCAL_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

export function resolveAllowedOrigins(
  nodeEnv: string | undefined,
  value: string | undefined,
) {
  const configured = value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (configured && configured.length > 0) {
    return configured
  }
  if (nodeEnv === 'production') {
    throw new Error('ALLOWED_ORIGINS is required in production.')
  }
  return [...LOCAL_ALLOWED_ORIGINS]
}

export function resolveAdminUsernames(value: string | undefined) {
  return new Set(
    value
      ?.split(',')
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean) ?? [],
  )
}
