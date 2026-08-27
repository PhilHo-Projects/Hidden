import type { Pool } from 'pg'
import { createDatabasePool } from '../database.js'
import { runMigrations } from '../migrations.js'
import { AdminRoleError, setAdminRole, type ManagedRole } from './role.js'

const USAGE =
  'Usage: admin:role -- --user <username-or-email> --role <admin|player>'

interface RoleCliDependencies {
  databaseUrl: string | undefined
  createPool(connectionString: string): Pool
  migrate(pool: Pool): Promise<unknown>
  setRole: typeof setAdminRole
  write(value: string): void
}

function parseArguments(arguments_: readonly string[]) {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== '--user' ||
    !arguments_[1] ||
    arguments_[2] !== '--role' ||
    (arguments_[3] !== 'admin' && arguments_[3] !== 'player')
  ) {
    throw new Error(USAGE)
  }
  return {
    identifier: arguments_[1],
    role: arguments_[3] as ManagedRole,
  }
}

export async function runRoleCli(
  arguments_: readonly string[] = process.argv.slice(2),
  dependencies: RoleCliDependencies = {
    databaseUrl: process.env.DATABASE_URL,
    createPool: createDatabasePool,
    migrate: runMigrations,
    setRole: setAdminRole,
    write: (value) => process.stdout.write(value),
  },
) {
  const input = parseArguments(arguments_)
  if (!dependencies.databaseUrl) {
    throw new Error('DATABASE_URL is required.')
  }
  const pool = dependencies.createPool(dependencies.databaseUrl)
  try {
    await dependencies.migrate(pool)
    const result = await dependencies.setRole(pool, input)
    dependencies.write(
      `${JSON.stringify({ event: 'admin.role_updated', role: result.role })}\n`,
    )
  } finally {
    await pool.end()
  }
}

if (import.meta.main) {
  void runRoleCli().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        event: 'admin.role_failed',
        code: error instanceof AdminRoleError ? error.code : 'operation_failed',
      })}\n`,
    )
    process.exitCode = 1
  })
}
