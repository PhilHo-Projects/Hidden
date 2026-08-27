import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

const MIGRATION_FILE_PATTERN = /^(\d{3}_[a-z0-9_]+)\.sql$/
const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../migrations/', import.meta.url),
)

async function migrationFiles(migrationsDirectory: string) {
  return (await readdir(migrationsDirectory))
    .map((file) => ({ file, match: MIGRATION_FILE_PATTERN.exec(file) }))
    .filter(
      (
        entry,
      ): entry is {
        file: string
        match: RegExpExecArray
      } => Boolean(entry.match),
    )
    .sort((first, second) => first.file.localeCompare(second.file))
}

export async function assertMigrationsCurrent(
  pool: Pool,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
) {
  const required = await migrationFiles(migrationsDirectory)
  let appliedResult: { rows: Array<{ version: string }> }
  try {
    appliedResult = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    )
  } catch {
    throw new Error(
      'Database schema is out of date. Run the explicit database migration command before starting Hidden.',
    )
  }
  const applied = new Set(appliedResult.rows.map(({ version }) => version))
  if (required.some(({ match }) => !applied.has(match[1]!))) {
    throw new Error(
      'Database schema is out of date. Run the explicit database migration command before starting Hidden.',
    )
  }
}

export async function runMigrations(
  pool: Pool,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
) {
  const client = await pool.connect()
  try {
    await client.query(
      `SELECT pg_advisory_lock(hashtext('hidden_schema_migrations'))`,
    )
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const appliedResult = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    )
    const applied = new Set(appliedResult.rows.map(({ version }) => version))
    const files = await migrationFiles(migrationsDirectory)

    for (const { file, match } of files) {
      const version = match[1]!
      if (applied.has(version)) {
        continue
      }

      const sql = await readFile(path.join(migrationsDirectory, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version],
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await client
      .query(`SELECT pg_advisory_unlock(hashtext('hidden_schema_migrations'))`)
      .catch(() => undefined)
    client.release()
  }
}
