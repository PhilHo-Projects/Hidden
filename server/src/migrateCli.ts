import type { Pool } from 'pg'
import { createDatabasePool } from './database.js'
import { runMigrations } from './migrations.js'

const USAGE = 'Usage: db:migrate'

interface MigrationCliDependencies {
  databaseUrl: string | undefined
  createPool(connectionString: string): Pool
  migrate(pool: Pool): Promise<unknown>
  write(value: string): void
}

export async function runMigrationCli(
  arguments_: readonly string[] = process.argv.slice(2),
  dependencies: MigrationCliDependencies = {
    databaseUrl: process.env.DATABASE_URL,
    createPool: createDatabasePool,
    migrate: runMigrations,
    write: (value) => process.stdout.write(value),
  },
) {
  if (arguments_.length > 0) {
    throw new Error(USAGE)
  }
  if (!dependencies.databaseUrl) {
    throw new Error('DATABASE_URL is required.')
  }

  const pool = dependencies.createPool(dependencies.databaseUrl)
  try {
    await dependencies.migrate(pool)
    dependencies.write(
      `${JSON.stringify({ event: 'database.migrations_applied' })}\n`,
    )
  } finally {
    await pool.end()
  }
}

if (import.meta.main) {
  void runMigrationCli().catch(() => {
    process.stderr.write(
      `${JSON.stringify({ event: 'database.migrations_failed' })}\n`,
    )
    process.exitCode = 1
  })
}
