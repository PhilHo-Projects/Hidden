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
