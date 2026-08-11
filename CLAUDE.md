# Hidden project instructions

`CLAUDE.md` and `AGENTS.md` are the same document for different tools. Edit both
identically; `npm test` fails when they differ.

## Start here

Read `docs/README.md`, then `docs/ROADMAP.md` for current work. Do not read all
archived plans or specs to orient yourself: completed detail is in Git, and each
historical file is only a short decision or outcome record.

## Scope

This repository is the web edition of Hidden. Keep it focused on the React
client, Node service, deterministic core, and production container. Do not add
credentials, machine-specific paths, unrelated prototypes, or legacy deployment
automation.

Reusable non-shipping design prototypes are the exception and live in
`art/lab/`. They are dependency-free HTML served by `art/lab/serve.mjs`, are not
an npm workspace, and must never become a dependency of shipping code.

## Source map

- `packages/game-core/` owns deterministic classic rules, topology, commands,
  timeouts, scoring, engine identity, and `GameConfig`.
- `server/src/matchCoordinator.ts` owns authoritative rooms, trusted seats,
  revisions, deadlines, command application, and completion.
- `server/src/gameHandler.ts` owns WebSocket sessions, transport, routing, and
  connection limits. `auth/`, `matchHistory/`, and `admin/` own their HTTP and
  persistence boundaries.
- `server/src/protocol.ts` and `web/src/game/protocol.ts` mirror the wire
  contract. Numeric packet IDs are permanent.
- `web/src/App.tsx` owns screen composition and navigation. Stateful subsystems
  live in `web/src/hooks/`; reusable UI lives in `web/src/components/`.
- `web/src/game/` owns online authority, transport adapters, and presentation
  projection. `web/src/history/` and `web/src/admin/` own feature data clients.
- `web/src/index.css` is an ordered manifest for `web/src/styles/`; import order
  is part of the global cascade contract. Reusable effects own their CSS under
  `web/src/animations/`.
- `web/src/assets/` is organized by backgrounds, fonts, icons, and textures.

## Commands

- Use Node 24 and install from the root with `npm ci`.
- Run `npm test`, `npm run lint`, and `npm run build` from the root.
- Integration tests use PostgreSQL through `TEST_DATABASE_URL` and remain
  separately invoked by the server package.
- Build the production artifact from the root `Dockerfile` before deployment.
- Start design prototypes with `cd art/lab && npm start`; install nothing there.

## Runtime contracts

- One HTTP process listens on port 8080, serves the compiled client, exposes
  `GET /healthz`, and accepts WebSocket upgrades only at `/ws`.
- Active matches and matchmaking are process-local. Production must use exactly
  one replica until shared state and reconnection are deliberately designed.
- Treat the connection-assigned client ID and seat as authoritative. Never trust
  a sender identity supplied inside a packet.
- Never change a published engine revision's behavior in place.
- Preserve packet validation, the 16 KiB ceiling, connection/message limits,
  heartbeat cleanup, response timeouts, structured logging, and graceful
  shutdown. Do not log raw packet bodies at `info`.

## Change discipline

- Preserve matchmaking, lobbies, ready/start, moves, power-ups, disconnects,
  and offline bot play unless the task explicitly changes gameplay.
- Add or update tests before runtime behavior changes.
- Browser-verify CSS/markup changes; unit tests cannot prove the cascade or
  class pairing remained correct.
- Verify all workspaces and the production container before deployment.
- Do not add automated deployment workflows. Hosting owns production delivery.
