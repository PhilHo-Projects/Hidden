import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool } from 'pg'

const MIGRATION_FILE_PATTERN = /^(\d{3}_[a-z0-9_]+)\.sql$/

export async function runMigrations(
  pool: Pool,
  migrationsDirectory = path.resolve(__dirname, '..', 'migrations'),
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
    const files = (await readdir(migrationsDirectory))
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
