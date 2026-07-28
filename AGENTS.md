# Hidden project instructions

## Scope

This repository is the web edition of Hidden. Keep it focused on the React
client, the Node service, and their container. Do not add unrelated prototypes,
credentials, machine-specific paths, or legacy deployment automation.

## Structure and commands

- `web/` contains the React 19 and Vite 8 client.
- `server/` contains the Express 5, `ws` 8, and MessagePack 3 service.
- Use Node 24.
- Run `npm test`, `npm run lint`, and `npm run build` in `web/`.
- Run `npm test` and `npm run build` in `server/`.
- Build the production artifact from the root `Dockerfile`.

## Runtime contracts

- One HTTP process listens on port 8080, serves the compiled client, exposes
  `GET /healthz`, and accepts WebSocket upgrades only at `/ws`.
- Active matches and matchmaking are process-local. Production must use exactly
  one replica until shared state and reconnection are deliberately designed.
- Preserve numeric packet IDs. Symbol names may improve, but changing an active
  number is a protocol-breaking change.
- Treat the connection-assigned client ID as authoritative. Never trust a sender
  ID supplied inside a packet.
- Keep packet validation, the 16 KiB payload ceiling, connection/message limits,
  heartbeat cleanup, response timeouts, structured logging, and graceful
  shutdown covered by tests.
- Do not log raw packet bodies at the default `info` level.

## Change discipline

- Preserve online matchmaking, lobby, ready/start, moves, power-ups,
  disconnect handling, and offline bot play unless a task explicitly changes
  gameplay.
- Add or update tests before changing runtime behavior.
- Verify both packages and the production container before deployment.
- Do not add automated deployment workflows. Production delivery is managed by
  the hosting platform's repository webhook.
