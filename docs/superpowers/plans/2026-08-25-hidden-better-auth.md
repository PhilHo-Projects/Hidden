# Hidden Better Auth Implementation Plan

**Goal:** Replace Hidden's custom account authentication with Better Auth 1.7.1 while preserving optional guest play, public usernames, game/history behavior, and a low-friction eight-character password policy.

**Architecture:** The Node 24 server becomes ESM and mounts Better Auth's Express handler as the sole account authority. Better Auth uses the existing PostgreSQL pool, the existing `users` table as its user model, prefixed auth-owned tables for accounts/sessions/verifications/rate limits, Hidden's existing Argon2id implementation, Resend email, Turnstile, and the username/HIBP plugins. HTTP and WebSocket consumers map Better Auth sessions to the existing public `{ id, username, role }` game identity. The React client uses Better Auth's typed client while keeping email private and guest entry unchanged.

**Global constraints:**

- Pin `better-auth` to exactly `1.7.1`; do not retain a second custom authentication path.
- Use Node 24. Convert only `server/` to NodeNext ESM; keep `@hidden/game-core` CommonJS-compatible.
- Add or update tests before runtime behavior. Watch each new test fail for the intended missing behavior before implementation.
- Passwords are 8-128 characters, hashed with the existing Argon2id implementation, screened through Have I Been Pwned, and have no composition rules.
- Signup requires verified email and Turnstile. MFA, social login, username changes, and account deletion are out of scope.
- Username is the only public identity. Email is returned only to the signed-in account UI and never enters game packets, history responses, public/admin account summaries, or default logs.
- Existing account rows are intentionally disposable. Migration preserves match snapshots, nulls participant account links through the existing FK, and removes bookmarks.
- Production uses one replica. Do not add deployment workflows or run the production migration from this development task.
- Keep `AGENTS.md` and `CLAUDE.md` byte-identical.

### Task 1: Establish ESM, dependencies, and the Better Auth database schema

**Files:** `server/package.json`, `server/tsconfig*.json`, server imports/entrypoints, `package-lock.json`, `server/migrations/005_better_auth.sql`, migration tests.

1. Add failing tests for the version-004-to-005 migration: old users/sessions/bookmarks removed; match rows and participant snapshots preserved; participant account IDs null; new schema constraints and foreign keys usable.
2. Pin `better-auth@1.7.1` and direct runtime dependencies required for the bounded Node handler. Add React-side dependency only when Task 4 needs it.
3. Convert the server package to NodeNext ESM, update relative specifiers, replace CommonJS entrypoint/path idioms, and keep the CLI/build/Docker entrypoints working.
4. Add migration 005. Retain and remodel `users`; create `auth_accounts`, `auth_sessions`, `auth_verifications`, and `auth_rate_limits`; replace the old session/password storage; use explicit UUIDs, snake_case mappings, role checks, username constraints, and indexes.
5. Run the migration tests, server typecheck/tests, and server build. Commit the task.

### Task 2: Build the Better Auth core, email, and security configuration

**Files:** server auth/config modules and focused tests.

1. Add failing tests for production configuration, Argon2 password hooks, eight-character boundaries, private user mapping, Resend requests, and bounded auth requests.
2. Build a central Better Auth factory against the PostgreSQL pool with explicit model mappings, UUID generation, username plugin validation (3-24 letters/numbers/underscore), and server-owned `role`/`lastSeenAt` fields.
3. Configure email/password with `autoSignIn: false`, required email verification, auto sign-in after verification, one-hour verification/reset tokens, reset-time session revocation, 30-day sessions, daily refresh, ten-minute freshness, and disabled cookie cache.
4. Use the existing Argon2id hash/verify functions and add the required eight-character policy comment. Enable the HIBP plugin on signup/change/reset.
5. Add database-backed endpoint rate limits and Turnstile on `/sign-up/email`, `/request-password-reset`, and `/send-verification-email`, not sign-in.
6. Add the production `__Host-hidden_session` cookie and safe development cookie. Configure trusted origins/proxy IP handling.
7. Implement an injected transactional-email interface and Resend implementation for verification, reset, and change-email messages; never log secrets or email addresses.
8. Implement a 4 KiB, JSON-only Better Auth Node handler mounted before Express body parsing.
9. Run focused red-green tests, then all server tests/build. Commit the task.

### Task 3: Integrate HTTP, WebSockets, history/admin authorization, cleanup, and role CLI

**Files:** server app/runtime/admin/history/WebSocket modules and tests.

1. Add failing tests for session-to-public-user mapping, HTTP authorization, WebSocket upgrade auth, periodic five-minute revocation checks, role refresh, cleanup, and role CLI behavior.
2. Replace cookie parsing/custom auth-service consumers with Better Auth `getSession` calls and a single mapper returning public `{ id, username, role }`.
3. Mount Better Auth as the only `/api/auth/*` implementation. Remove obsolete auth repositories/services/routes/session-token code and tests after replacement coverage exists.
4. Revalidate authenticated WebSockets every five minutes; close revoked/expired sessions and update changed roles. Leave guests unchanged.
5. Adapt admin stats/account queries to the new schema without returning email. Preserve history/bookmark authorization for new accounts.
6. Clean expired auth sessions and stale rate-limit rows on the existing cleanup lifecycle.
7. Replace password provisioning with `npm run admin:role -- --user <username-or-email> --role <admin|player>`. Require an existing verified user; support demotion; never handle passwords.
8. Run focused red-green tests, integration tests when `TEST_DATABASE_URL` is available, all server tests, and server build. Commit the task.

### Task 4: Replace the React account client and complete the in-game account UX

**Files:** `web/src/auth/**`, account/profile components, `App.tsx`, relevant CSS, web package metadata/tests.

1. Run the Impeccable setup for `web/`, preserve Hidden's established black/yellow brush-and-ink design language, and reuse current dialog/form conventions.
2. Add failing client/component tests for: username-or-email sign-in; signup with email/password confirmation/Turnstile; verification pending/resend; forgot/reset password; URL token consumption/sanitization; verified email change; password change; session listing/revocation; sign-out-other-devices; accessible errors; private email; and unchanged guest entry.
3. Create the Better Auth React client with the username plugin and a Hidden-facing error/identity adapter. Select email sign-in only when the identifier contains `@`; public app state remains `{ id, username, role }`.
4. Build the complete dialog state machine and account settings. Use generic recovery responses and accessible live status. Keep username immutable and email private.
5. Integrate Turnstile using `VITE_TURNSTILE_SITE_KEY`; send its token through `x-captcha-response` only on protected endpoints and reset it after every attempt.
6. Verification redirects to `/?auth=verified` and signs in automatically. Reset links use `/?auth=reset-password&token=...`; consume the token into memory and remove it from the address bar before rendering. Add `Referrer-Policy: no-referrer`.
7. Preserve guest play and all gameplay/navigation behavior. Ensure responsive and reduced-motion behavior match the existing UI.
8. Run focused red-green tests, all web tests, lint, and build. Commit the task.

### Task 5: Documentation, invariants, and full verification

**Files:** `docs/AUTH_IMPLEMENTATION.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, deployment/config documentation.

1. Create the durable auth log with the custom-auth audit, decision history, Hidden architecture, PersonalSoundCloud differences, environment/setup/migration/rollback runbooks, password-policy upgrade procedure, reusable three-category auth checklist, and commands/results. Include no secrets.
2. Update README setup, local/production configuration, auth flows, admin-role command, destructive migration warning, Resend/Turnstile preparation, and rollback requirements. Remove obsolete `ADMIN_USERNAMES` and password-provision instructions.
3. Add lasting auth invariants to both instruction files identically.
4. Run the complete root test suite, web lint/build, server build/integration tests when configured, production Docker build, container health check, and a browser happy path with injected/fake external services. Record exact results and any environmental skips in the auth log.
5. Review the final diff against every global constraint and commit the task.

## Acceptance criteria

- Guests can still reach and play the game without creating an account.
- Registration cannot create a session until email is verified; valid verification automatically signs in.
- Username and email both sign in to the same user, but only username is public.
- Password recovery and changes are self-service in the game; resets revoke existing sessions.
- Production auth requests enforce Turnstile where specified, bounded bodies, trusted origins, durable rate limits, secure cookies, and Argon2id/HIBP password handling.
- Revoked authenticated WebSocket sessions are disconnected within five minutes.
- Roles are database-backed and managed without administrator password handling.
- Migration tests demonstrate the intentional account reset and preservation of match snapshots.
- Documentation is sufficient to reuse the design in a later project without repeating the architecture discussion.
