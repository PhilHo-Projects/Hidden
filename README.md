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

To enable local accounts, set `DATABASE_URL` to a PostgreSQL 16 database before
starting the service. Migrations run automatically before HTTP begins:

```powershell
$env:DATABASE_URL='postgresql://hidden:password@127.0.0.1:5432/hidden'
npm start
```

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

Username/password accounts and browser sessions are stored in PostgreSQL.
Accounts are optional: guests retain unrestricted online and offline play.
Matchmaking and active matches are still intentionally held in memory, so run
exactly one application replica. Match history, replay persistence, and
reconnection sessions are not part of this release.

Production configuration:

| Variable | Default |
| --- | --- |
| `PORT` | `8080` |
| `DATABASE_URL` | required in production; guest-only when absent in development |
| `LOG_LEVEL` | `info` |
| `ALLOWED_ORIGINS` | required in production; local Vite origins otherwise |
| `ADMIN_USERNAMES` | optional comma-separated, case-insensitive admin usernames; none by default |
| `MAX_CONNECTIONS` | `100` |
| `MAX_MESSAGES_PER_SECOND` | `30` |
| `MAX_PAYLOAD_BYTES` | `16384` |
| `HEARTBEAT_INTERVAL_MS` | `30000` |
| `TRUST_PROXY_HOPS` | `1` in production; disabled otherwise |

The live application is available at
[`https://hidden.philippeho.dev`](https://hidden.philippeho.dev).
