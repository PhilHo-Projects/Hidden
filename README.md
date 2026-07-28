# Hidden

Hidden is a small blind-board strategy game: a turn-based mix of tic-tac-toe,
battleship, and rock-paper-scissors with a few power-ups.

The repository contains only the browser game and its multiplayer service:

- `web/` — React 19, TypeScript, and Vite 8.
- `server/` — Express 5, `ws` 8, and MessagePack 3.
- `Dockerfile` — a multi-stage Node 24 image that serves both the compiled app
  and WebSocket endpoint.

## Run locally

Install both packages:

```powershell
cd web
npm ci
cd ..\server
npm ci
```

Start the server on port 8080, then start Vite on port 5173:

```powershell
cd server
npm run dev
```

```powershell
cd web
npm run dev
```

Vite proxies `/ws` to `ws://127.0.0.1:8080`. Set `VITE_WS_URL` to an explicit
`ws://` or `wss://` endpoint when a local browser should use another server.
Offline play does not require the server.

## Verify

```powershell
cd server
npm test
npm run build

cd ..\web
npm test
npm run lint
npm run build
```

The production container listens on port 8080, responds to `GET /healthz`, serves
the single-page app, and accepts WebSocket upgrades only at `/ws`.

## Runtime model

Matchmaking and active matches are intentionally held in memory. Run exactly one
replica: there are no accounts, persistence, or reconnection sessions yet.

Production configuration:

| Variable | Default |
| --- | --- |
| `PORT` | `8080` |
| `LOG_LEVEL` | `info` |
| `ALLOWED_ORIGINS` | local Vite origins |
| `MAX_CONNECTIONS` | `100` |
| `MAX_MESSAGES_PER_SECOND` | `30` |
| `MAX_PAYLOAD_BYTES` | `16384` |
| `HEARTBEAT_INTERVAL_MS` | `30000` |

The live application is available at
[`https://hidden.philippeho.dev`](https://hidden.philippeho.dev).
