# Hidden project instructions

`CLAUDE.md` and `AGENTS.md` are one document kept in two files: Claude Code
reads the first, Codex reads the second, and each tool sees only its own. A rule
added to one applies to nobody else. Edit both. `npm test` fails if they differ.

## Scope

This repository is the web edition of Hidden. Keep it focused on the React
client, the Node service, and their container. Do not add unrelated prototypes,
credentials, machine-specific paths, or legacy deployment automation.

Design prototypes for this game are the one exception, and they live in
`art/lab/`. Nothing there ships or is installed: it is dependency-free HTML
served by `art/lab/serve.mjs`, it is not an npm workspace, and it must never
become a dependency of anything under `web/` or `server/`.

Build them there rather than in a scratch directory outside the repo — a
prototype nobody can find again was wasted work. The only exception is a
throwaway snippet meant to be looked at once.

## Structure and commands

- `web/` contains the React 19 and Vite 8 client.
- `server/` contains the Express 5, `ws` 8, and MessagePack 3 service.
- `art/` holds non-shipping design work; `art/lab/` holds the runnable
  prototypes. Start them with `cd art/lab && npm start`; there is nothing to
  install.
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

## Authentication contracts

- Pinned `better-auth@1.7.1` is the sole account authority. Do not add a
  fallback login/session path or allow the Better Auth schema to drift without
  a reviewed numbered migration.
- Accounts remain optional and guest gameplay must stay immediate. Public game,
  history, WebSocket, and admin identity is limited to `{ id, username, role }`;
  email and verification state are private to the signed-in account UI.
- Never mutate the database schema during application startup. Run
  `npm run db:migrate --workspace=hidden-server` explicitly. Migration 005
  intentionally resets old accounts/bookmarks and requires a backup plus the
  prior image for production rollback.
- Passwords are deliberately 8-128 characters with Argon2id and breached-password
  screening. Changing the minimum does not upgrade existing credentials; follow
  `docs/AUTH_IMPLEMENTATION.md` for the credential-policy/reset procedure.
- Production auth uses the host-only `__Host-hidden_session` cookie, JSON-only
  4 KiB auth bodies, exact trusted origins, database rate limits, and Turnstile
  on signup/recovery/verification resend. Authenticated WebSockets must
  revalidate in at most five minutes.
- Roles come only from PostgreSQL. Use `npm run admin:role` for verified accounts;
  do not reintroduce `ADMIN_USERNAMES` or password provisioning.
- Tests use injected email/external-service fakes. Never log or commit email
  addresses, passwords, cookies, tokens, provider secrets, or complete auth URLs.

## Change discipline

- Preserve online matchmaking, lobby, ready/start, moves, power-ups,
  disconnect handling, and offline bot play unless a task explicitly changes
  gameplay.
- Add or update tests before changing runtime behavior.
- Verify both packages and the production container before deployment.
- Do not add automated deployment workflows. Production delivery is managed by
  the hosting platform's repository webhook.
