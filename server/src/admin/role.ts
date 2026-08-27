import type { Pool } from 'pg'

export type ManagedRole = 'admin' | 'player'
export type AdminRoleErrorCode =
  | 'invalid_identifier'
  | 'invalid_role'
  | 'account_not_found'
  | 'email_not_verified'

export class AdminRoleError extends Error {
  constructor(readonly code: AdminRoleErrorCode, message: string) {
    super(message)
    this.name = 'AdminRoleError'
  }
}

export async function setAdminRole(
  pool: Pool,
  input: { identifier: string; role: ManagedRole },
) {
  const identifier = input.identifier.trim().toLowerCase()
  if (!identifier) {
    throw new AdminRoleError(
      'invalid_identifier',
      'A user identifier is required.',
    )
  }
  if (input.role !== 'admin' && input.role !== 'player') {
    throw new AdminRoleError('invalid_role', 'Role must be admin or player.')
  }
  const found = await pool.query<{ id: string; email_verified: boolean }>(
    `SELECT id, email_verified
     FROM users
     WHERE username = $1 OR lower(email) = $1
     LIMIT 1`,
    [identifier],
  )
  const user = found.rows[0]
  if (!user) {
    throw new AdminRoleError('account_not_found', 'Account was not found.')
  }
  if (!user.email_verified) {
    throw new AdminRoleError(
      'email_not_verified',
      'Account email must be verified before its role can be changed.',
    )
  }
  const updated = await pool.query(
    'UPDATE users SET role = $2 WHERE id = $1',
    [user.id, input.role],
  )
  if (updated.rowCount !== 1) {
    throw new AdminRoleError('account_not_found', 'Account was not found.')
  }
  return { role: input.role }
}
