# Hidden authentication implementation log

Last updated: 2026-08-27

## Status and purpose

Hidden now uses pinned `better-auth@1.7.1` as its sole account authority. Guest
play remains immediate and does not require an account. This document records
the security reasoning, the Hidden-specific implementation, the destructive
migration and deployment procedure, and a compact checklist for later projects.

The code is implemented and locally verified. Production cutover is deliberately
separate: Resend DNS, the Turnstile hostname, Coolify variables, a database
backup, pre-migration counts, and one real staging flow must be completed before
migration 005 is run against production.

## Starting audit: why the old Hidden auth scored well

The 17 August 2026 Hetzner audit rated the original Hidden implementation 9/10
and used it as the fleet's reference implementation. That assessment was
reasonable for the narrow login/session system that existed:

- passwords used individually salted Argon2id at the intended memory/time cost;
- sessions were opaque, database-backed, expiring, and immediately revocable;
- the production cookie was host-only, secure, HTTP-only, and same-site;
- state-changing requests enforced an origin allowlist;
- login used account/IP throttling, generic credential errors, and dummy password
  work to reduce account-enumeration timing;
- login rotated sessions and the implementation had unusually thorough tests.

The audit's “nothing serious” conclusion described resistance to password and
session attacks. It did not mean the account lifecycle was complete.

## Gaps and risks in the custom implementation

The old code had no private email identity, email verification, password reset,
email change, device/session management UI, recovery path for administrators, or
portable conventions for other projects. Its limiter was process-local, and its
bespoke route/schema/client contract meant every new lifecycle feature would
have required more custom security code. There was also no bot-cost control at
signup and no standard extension path for passkeys or MFA.

The migration therefore preserves the strongest primitives—Argon2id,
server-side sessions, restrictive cookies, origin checks, throttling, and a
public/private identity boundary—while handing lifecycle routing and credential
semantics to Better Auth.

## Decisions from the design discussion

- Hidden is the public multi-user category: accounts may grow, but gameplay must
  remain available to guests.
- Better Auth is the right fit because Hidden needs account lifecycle features,
  not just a shared gate or an identity proxy in front of a personal tool.
- Passwords remain 8-128 characters with no composition rules. Eight characters
  is an explicit low-friction game choice supported by Argon2id, breached-password
  screening, verified email, and throttling. Email verification and Turnstile
  are not MFA and do not prove a human identity.
- Email is private. The public identity contract remains exactly `{ id,
  username, role }` across gameplay, history, WebSockets, and admin responses.
- Existing pre-email accounts are disposable. Migration 005 deletes them,
  cascades old sessions/bookmarks, nulls historical participant ownership, and
  preserves match snapshots and snapshot usernames.
- Administrators register and recover through the same UI as players. A verified
  account is promoted afterward; no password provisioner or username allowlist
  remains.
- MFA, passkeys, social login, username changes, account deletion, and automated
  deployment are deferred.

## Implemented architecture

### Authority and request boundary

- The Node 24 server package is NodeNext ESM; the shared game core remains
  CommonJS-compatible.
- One Better Auth factory owns all `/api/auth/*` routes and uses the existing
  PostgreSQL pool. No legacy login, registration, or session-token fallback
  exists.
- The auth handler is mounted before `express.json()`. Its Node adapter accepts
  JSON only, streams at most 4 KiB, rejects unsupported media types, and forwards
  only Express's trusted-proxy-resolved client IP through a private header.
- Application startup only checks that numbered migrations are current. It never
  mutates the schema. `npm run db:migrate --workspace=hidden-server` is the sole
  application migration command.

### Identity and schema

Migration 005 retains `users` because match-history foreign keys already target
it, and creates these Better Auth-owned tables:

| Table | Purpose |
| --- | --- |
| `users` | UUID identity, normalized private email, verification flag, canonical lowercase username, display username, server-owned role, profile timestamps, last seen |
| `auth_accounts` | credential provider record and Argon2id password hash |
| `auth_sessions` | revocable 30-day server-side sessions |
| `auth_verifications` | reset state plus Hidden's hashed one-use email-token records |
| `auth_rate_limits` | database-backed request counters |

All IDs are PostgreSQL UUIDs with `gen_random_uuid()` defaults because Better
Auth's PostgreSQL UUID mode expects native database generation. Username is
immutable, 3-24 ASCII letters/numbers/underscore, canonicalized to lowercase,
and paired with a case-preserving display value. `role` defaults to `player`, is
never accepted from client input, and is constrained to `player | admin`.

### Account flows

- Signup requires username, email, password confirmation, and Turnstile. It
  creates no session and sends a one-hour verification link.
- Hidden stores only a SHA-256 identifier for each emailed verification token
  and atomically consumes it before Better Auth verifies the JWT. Reuse or
  expiry redirects back with `INVALID_TOKEN`; successful verification signs in.
- Login accepts either username or email and returns the same account.
- Recovery always returns the same user-facing success message. Reset links live
  for one hour, are single-use, and a successful reset revokes every session.
- Email change requires a session created less than ten minutes ago, confirms
  the current address, then verifies the new address.
- Password change requires the current password and a session less than ten
  minutes old, screens the new password, and signs out other devices.
- Settings list sessions, revoke a selected other session, sign out all other
  sessions, and expose only the signed-in user's own email.
- Reset tokens are copied into memory and removed from browser history before
  the form renders. The document uses `Referrer-Policy: no-referrer`.

### Security settings

- Passwords: 8-128 characters, Hidden's Node 24 Argon2id hooks, HIBP screening on
  signup/reset/change. HIBP failure is closed and reported as retryable service
  unavailability.
- Verification/reset lifetime: one hour.
- Sessions: 30 days, daily database refresh, no cookie session cache.
- Sensitive mutation freshness: ten minutes. Hidden enforces this centrally
  because Better Auth 1.7.1 does not automatically apply `freshAge` to its
  password/email mutation endpoints.
- Production cookie: `__Host-hidden_session`; `Secure`, `HttpOnly`,
  `SameSite=Strict`, `Path=/`, no Domain. Development uses `hidden_session`.
- Rate limits use PostgreSQL: sign-in 10/15 minutes per endpoint/IP; signup
  3/hour; reset requests and verification resends 3/hour; password/email changes
  5/15 minutes.
- Turnstile protects signup, recovery requests, and verification resends—not
  ordinary login.
- Authenticated WebSockets resolve Better Auth at upgrade and revalidate every
  five minutes. Revoked/expired sessions close; role changes refresh; guests are
  untouched. The production interval cannot be configured above five minutes.
- Expired sessions and stale rate-limit rows use the existing periodic cleanup
  lifecycle.

### Email provider

`TransactionalEmail` isolates auth code from Resend. Production sends
verification, reset, and email-change messages from `Hidden
<no-reply@philippeho.dev>`. Tests inject fakes. Logs must never include email
addresses, passwords, cookies, tokens, or complete action URLs.

## Differences from PersonalSoundCloud

PersonalSoundCloud supplied the useful Better Auth 1.7.1 pattern, username
plugin, server-owned fields, and “no session on signup” behavior, but its trust
model is different:

- it uses SQLite and owner approval; Hidden uses PostgreSQL plus verified email;
- its email addresses are not verified and it has no mail provider; Hidden uses
  Resend verification, recovery, and email-change flows;
- its recovery historically required direct database intervention; Hidden is
  self-service in the game;
- Hidden adds Turnstile, HIBP checks, one-use email tokens, device/session UI,
  five-minute WebSocket revalidation, and database-backed distributed rate
  limits;
- Hidden pins `better-auth` exactly rather than using a caret range and keeps a
  reviewed handwritten numbered migration. Do not regenerate Hidden's schema
  with the deprecated/out-of-version Better Auth CLI.

## Configuration

Copy `.env.example` for local reference; never commit real values.

| Variable | Phase | Requirement |
| --- | --- | --- |
| `DATABASE_URL` | runtime and CLI | Required in production; absence enables guest-only development |
| `BETTER_AUTH_URL` | runtime | `https://hidden.philippeho.dev` in production |
| `BETTER_AUTH_SECRET` | runtime | Distinct random secret, at least 32 bytes |
| `RESEND_API_KEY` | runtime | Required whenever database auth is enabled |
| `AUTH_EMAIL_FROM` | runtime | `Hidden <no-reply@philippeho.dev>` |
| `TURNSTILE_SECRET_KEY` | runtime | Server-side Turnstile secret |
| `ALLOWED_ORIGINS` | runtime | Comma-separated exact browser origins |
| `TRUST_PROXY_HOPS` | runtime | `1` for the current Coolify/Traefik topology |
| `VITE_TURNSTILE_SITE_KEY` | image build | Public site key; Docker/Vite production build fails without it |

Changing `BETTER_AUTH_SECRET` immediately invalidates signed session cookies and
outstanding signed email links. Treat rotation as a coordinated sign-out/reset
event.

`VITE_TURNSTILE_SITE_KEY` is intentionally a public client identifier, despite
Docker's generic secret-in-build-argument warning. Never pass
`TURNSTILE_SECRET_KEY`, `BETTER_AUTH_SECRET`, or `RESEND_API_KEY` as image build
arguments.

## Migration and production cutover

Migration 005 is intentionally destructive to accounts. Do not run it casually.

1. Verify the Resend sender domain and that Turnstile permits
   `hidden.philippeho.dev`.
2. Add all runtime variables and the public Docker build argument in Coolify.
3. Confirm the application is configured for exactly one replica.
4. Take a restorable database backup and note the prior application image.
5. Record pre-migration counts:

   ```sql
   SELECT count(*) AS users FROM users;
   SELECT count(*) AS matches FROM match_history_records;
   SELECT count(*) AS bookmarks FROM match_history_bookmarks;
   ```

6. Stop or isolate application writes, then run exactly once from the target
   image/environment:

   ```powershell
   npm run db:migrate --workspace=hidden-server
   ```

7. Start one replica. Confirm `/healthz`, guest play, and schema readiness.
8. Register and verify the administrator in the game, then promote it:

   ```powershell
   npm run admin:role --workspace=hidden-server -- --user <username-or-email> --role admin
   ```

   Demotion uses the same command with `--role player`. Missing or unverified
   accounts are refused.
9. Verify signup, verification, username/email login, recovery, WebSockets,
   history, and admin access. Watch logs without exposing private auth data.

Rollback requires both the pre-cutover database backup and the prior application
image. Rolling back only the image cannot reconstruct deleted account ownership
or bookmarks.

## Password-length upgrade runbook

Raising `minPasswordLength` does not invalidate existing Argon2id hashes and does
not make Better Auth know which old password is short. A future increase must:

1. add a credential-policy version to the credential/account model;
2. stamp newly set passwords with the new version;
3. mark older credentials as upgrade-required at login/session resolution;
4. route affected users through the in-game reset flow;
5. revoke their old sessions after reset;
6. remove the compatibility state only after the migration window.

Do not simply change 8 to 15 and claim existing accounts were upgraded.

## Reusable auth-selection checklist

### Personal tools

- Prefer an identity-aware access proxy (for example Cloudflare Access) when the
  whole app is private and per-user in-app ownership is unnecessary.
- Keep local auth only when offline/local access or application roles demand it.
- Use MFA/passkeys at the proxy for sensitive personal or financial data.

### Public multi-user applications

- Use a maintained auth authority and durable database sessions.
- Define public identity separately from private account/profile data.
- Include verification, recovery, secure email change, session management,
  throttling, breached-password defense, CSRF/origin checks, and bot-cost control
  where signup abuse matters.
- Write and test migrations; never let application startup mutate production
  schema.

### Controlled shared tools

- If individual attribution is unnecessary, use an access proxy or a strong
  separately managed shared secret with short revocable sessions.
- If actions need attribution or permissions differ, use individual accounts;
  do not stretch a shared-password design into pseudo-roles.
- Never use short PINs, known fallback passwords, plaintext comparison, or
  unthrottled public login endpoints.

## Verification record

Commands contain no production credentials.

| Check | Result on 2026-08-27 |
| --- | --- |
| Baseline root suite | Passed before implementation: core 41, web 191, server 147 |
| Web tests | Passed: 33 files, 205 tests |
| Web lint | Passed |
| Web production build with injected public test key | Passed |
| Web build without site key | Failed as intended |
| Server unit/type suite | Passed: 20 files, 208 tests; 23 DB-gated tests skipped in the no-DB run |
| Disposable PostgreSQL integration suite | Passed: 22 tests, including six full Better Auth lifecycle tests |
| Server build | Passed |
| Complete root test suite | Passed: core 41, web 205, server 208; 23 DB-gated tests skipped only in the no-DB root run |
| Complete root lint and build | Passed with an injected public Turnstile test site key |
| Production Docker build | Passed on the Hetzner Docker host from the committed source archive |
| Container migration and health smoke test | Passed against disposable PostgreSQL 17; `/healthz` returned `ok`, auth returned no session, and the compiled client loaded |
| Browser account-flow QA | Passed at desktop and 390×844 mobile sizes with service fakes; guest entry, signup, verification pending, sign-in, settings/devices, and reset-token URL sanitization worked with no console errors |
| Production dependency audit | Passed with zero known vulnerabilities after pinning `nanoid@3.3.18` |

The Docker verification used fake production credentials and disposable data;
it did not contact Resend, Turnstile, or the production database. One real
Resend/Turnstile staging registration and recovery flow remains a required
external pre-cutover check, not a locally simulated success.
