# Admin workbench decision

Status: shipped as a read-only boundary.

## Problem

Operators needed one safe surface for process health and stored research data
without creating moderation tools, database access, or a general remote console.

## Decision

- Derive admin role from the case-insensitive `ADMIN_USERNAMES` allowlist at
  login and request time. Store no role in PostgreSQL and privilege no username
  in client code.
- Re-authorize every `/api/admin` request from the session. Return structured
  401/403/400/404/503 errors and `Cache-Control: no-store`.
- Keep admin DTOs separate from game/WebSocket contracts and exclude password
  hashes, session-token hashes, and packet bodies.
- Provide a near-full-screen dialog with Stats, Matches, Accounts, and Console.
  Stats distinguishes process-local counts from database totals; ledgers use
  keyset pagination and phone list/detail navigation.
- Console executes only the client-side allowlist `help`, `status`, and `clear`.

## Lasting constraints

- Visibility is convenience, never authorization.
- Runtime counts are process-local while production uses one replica.
- Stored matches are final snapshots, not replays, and receive no playback UI.
- The workbench remains unavailable during active match phases.
- No shell, SQL, eval, arbitrary RPC, moderation, deletion, or destructive
  action exists without a separate design, audit trail, and confirmation model.
- Provisioning takes password input through standard input, creates independent
  Argon2id hashes transactionally, and never stores a deployment password.
