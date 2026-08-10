import { createDatabasePool } from '../database'
import { runMigrations } from '../migrations'
import {
  AdminProvisionConflictError,
  provisionAdminAccounts,
} from './provision'

function usernamesFromArguments(arguments_: readonly string[]) {
  const usernames: string[] = []
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== '--username' || !arguments_[index + 1]) {
      throw new Error(
        'Usage: provisionCli --username VinceAdmin --username PhilAdmin < password.txt',
      )
    }
    usernames.push(arguments_[index + 1]!)
    index += 1
  }
  return usernames
}

async function readPasswordFromStandardInput() {
  if (process.stdin.isTTY) {
    throw new Error(
      'Pipe the password through standard input so it is not stored in command arguments.',
    )
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const input = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  if (input.includes('\n') || input.includes('\r')) {
    throw new Error('Standard input must contain exactly one password line.')
  }
  return input
}

export async function runProvisionCli(
  arguments_: readonly string[] = process.argv.slice(2),
) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required.')
  const usernames = usernamesFromArguments(arguments_)
  const password = await readPasswordFromStandardInput()
  const pool = createDatabasePool(databaseUrl)
  try {
    await runMigrations(pool)
    const result = await provisionAdminAccounts(pool, usernames, password)
    for (const account of result) {
      process.stdout.write(
        `${JSON.stringify({ event: 'admin.provisioned', ...account })}\n`,
      )
    }
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  void runProvisionCli().catch((error: unknown) => {
    const fields =
      error instanceof AdminProvisionConflictError
        ? { event: 'admin.provision_conflict', username: error.username }
        : {
            event: 'admin.provision_failed',
            errorClass: error instanceof Error ? error.name : typeof error,
          }
    process.stderr.write(`${JSON.stringify(fields)}\n`)
    process.exitCode = 1
  })
}
