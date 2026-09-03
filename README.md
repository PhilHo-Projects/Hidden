# Hidden

Hidden is a small blind-board strategy game: a turn-based mix of tic-tac-toe,
battleship, and rock-paper-scissors with a few power-ups.

The repository contains only the browser game and its multiplayer service:

- `web/` — React 19, TypeScript, and Vite 8.
- `server/` — Express 5, `ws` 8, and MessagePack 3.
- `Dockerfile` — a multi-stage Node 24 image that serves both the compiled app
  and WebSocket endpoint.

## Run locally

Install the root workspace once:

```powershell
npm ci
```

Build and start the server on port 8080, then start Vite on port 5173:

```powershell
cd server
npm run build
npm start
```

```powershell
cd web
npm run dev
```

Vite proxies `/api` and `/ws` to the local service. Set `VITE_WS_URL` to an
explicit `ws://` or `wss://` endpoint when a local browser should use another
server. Without `DATABASE_URL`, a non-production service starts in explicit
guest-only mode and its account endpoints return `503`. Online guest play and
offline play remain available.

To enable local accounts, copy `.env.example`, provide a PostgreSQL database and
the remaining auth values, then run migrations explicitly before starting. The
application refuses to start against an outdated schema and never mutates it at
startup:

```powershell
$env:DATABASE_URL='postgresql://hidden:password@127.0.0.1:5432/hidden'
$env:BETTER_AUTH_URL='http://127.0.0.1:8080'
$env:BETTER_AUTH_SECRET='<at-least-32-random-bytes>'
$env:RESEND_API_KEY='<development-provider-key>'
$env:AUTH_EMAIL_FROM='Hidden <no-reply@philippeho.dev>'
$env:TURNSTILE_SECRET_KEY='<development-secret-key>'
$env:ALLOWED_ORIGINS='http://127.0.0.1:5173,http://localhost:5173'
npm run db:migrate --workspace=hidden-server
npm run build --workspace=hidden-server
npm start --workspace=hidden-server
```

The Vite client also needs the public `VITE_TURNSTILE_SITE_KEY`. Production web
and Docker builds fail when it is missing.

### Accounts

Accounts are optional and Better Auth is their only authority. Signup asks for a
username, private email, password, and Turnstile check; it creates no session
until the one-hour email link is verified. Players may then sign in by username
or email, recover or change a password, verify a new email, and manage device
sessions inside the game. Only username and role enter public/game responses.

Passwords are 8-128 characters with no symbol/case rules. Hidden uses Argon2id,
breached-password screening, verified email, and database-backed throttles. See
[`docs/AUTH_IMPLEMENTATION.md`](docs/AUTH_IMPLEMENTATION.md) for the complete
security model, migration/rollback procedure, and reusable checklist.

### Admin workbench

Administrators get a read-only workbench from the signed-in profile menu. It
shows process-local activity, database totals, every stored match snapshot,
account/session aggregates, and a small allowlisted console. The admin HTTP
boundary is `/api/admin`; its responses are never cached and it returns `401`
for guests and `403` for signed-in players. Credential hashes, session tokens,
private emails, and raw packets are never included.

Roles are server-owned database fields. Register and verify the account through
the normal in-game flow, then promote it by username or email:

```powershell
npm run admin:role --workspace=hidden-server -- --user <username-or-email> --role admin
```

Use `--role player` to demote. The command requires `DATABASE_URL` and refuses a
missing or unverified account; it never reads or changes passwords.

## Verify

```powershell
npm test
npm run lint
npm run build

$env:TEST_DATABASE_URL='postgresql://hidden_test:password@127.0.0.1:5432/hidden_test'
npm run test:integration --workspace=hidden-server
```

The package-specific gates remain available when iterating on one package:

```powershell
npm run test --workspace=@hidden/game-core
npm run build --workspace=@hidden/game-core

npm run test --workspace=hidden-web
npm run lint --workspace=hidden-web
npm run build --workspace=hidden-web

npm run test --workspace=hidden-server
$env:TEST_DATABASE_URL='postgresql://hidden_test:password@127.0.0.1:5432/hidden_test'
npm run test:integration --workspace=hidden-server
npm run build --workspace=hidden-server
```

The production container listens on port 8080, responds to `GET /healthz`, serves
the single-page app, and accepts WebSocket upgrades only at `/ws`.

## Runtime model

Verified email/password accounts and browser sessions are stored in PostgreSQL
through pinned `better-auth@1.7.1`. Accounts are optional: guests retain
unrestricted online and offline play.
Matchmaking and active matches are still intentionally held in memory, so run
exactly one application replica. Completed online matches persist as final
snapshots with W/L/T totals and per-account bookmarks. Participants see only
their own history; administrators can inspect the global snapshot ledger.
Snapshots contain final boards and metadata, not ordered commands, so action
playback and reconnection sessions are not part of this release.

Production configuration:

| Variable | Default |
| --- | --- |
| `PORT` | `8080` |
| `DATABASE_URL` | required in production; guest-only when absent in development |
| `BETTER_AUTH_URL` | required; `https://hidden.philippeho.dev` in production |
| `BETTER_AUTH_SECRET` | required; distinct random value of at least 32 bytes |
| `RESEND_API_KEY` | required when accounts are enabled |
| `AUTH_EMAIL_FROM` | `Hidden <no-reply@philippeho.dev>` after domain verification |
| `TURNSTILE_SECRET_KEY` | required when accounts are enabled |
| `VITE_TURNSTILE_SITE_KEY` | required public Docker/Vite build argument |
| `LOG_LEVEL` | `info` |
| `ALLOWED_ORIGINS` | required in production; local Vite origins otherwise |
| `MAX_CONNECTIONS` | `100` |
| `MAX_MESSAGES_PER_SECOND` | `30` |
| `MAX_PAYLOAD_BYTES` | `16384` |
| `HEARTBEAT_INTERVAL_MS` | `30000` |
| `TRUST_PROXY_HOPS` | `1` in production; disabled otherwise |

Migration 005 intentionally deletes all pre-email accounts and bookmarks while
preserving match snapshots and their usernames. Production cutover requires a
database backup and the prior application image; rollback needs both.

The live application is available at
[`https://hidden.philippeho.dev`](https://hidden.philippeho.dev).
