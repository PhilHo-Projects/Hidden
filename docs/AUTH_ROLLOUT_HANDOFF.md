# Hidden Better Auth rollout handoff

Last updated: 2026-09-02

## Start here

This is the short operational handoff for finishing the Better Auth rollout.
The implementation and security rationale live in
[`AUTH_IMPLEMENTATION.md`](AUTH_IMPLEMENTATION.md); the approved build plan is
[`superpowers/plans/2026-08-25-hidden-better-auth.md`](superpowers/plans/2026-08-25-hidden-better-auth.md).

Work from this existing worktree and branch:

```text
Worktree: E:\Unity Projects\Hidden\.worktrees\better-auth
Branch:   codex/better-auth
Remote:   origin/codex/better-auth
Implementation baseline: d3b2206
Base:     origin/main at 3698a21
```

Resume from the remote branch tip; the handoff itself was committed after the
implementation baseline above.

Read `AGENTS.md` before acting. The user explicitly wants the rollout handled
inline, without subagents, and wants one slow dashboard step at a time. Never
ask the user to paste a provider secret into chat. When the user explicitly says
a specific key is copied, read it from the Windows clipboard, store it without
printing it, and clear the clipboard in a `finally` block.

## Implementation state

- Pinned `better-auth@1.7.1` is implemented as the sole account authority.
- Guest play remains immediate.
- Migration 005 intentionally deletes legacy users/bookmarks and preserves match
  snapshots while nulling obsolete participant account links.
- Email verification, recovery, email change, password change, device sessions,
  database rate limits, HIBP checks, Turnstile, restrictive cookies, role CLI,
  and five-minute WebSocket session revalidation are implemented.
- The branch includes current `main` through `3698a21` and is pushed.
- The 2026-09-02 no-database pass was green: core 47, web 221, server 214,
  lint/build/audit green. The 23 PostgreSQL-gated tests, final Docker build, and
  final container smoke test still must be rerun before cutover.

## Provider state

### Resend

- The user created a Resend account.
- `philippeho.dev` is verified for sending. Cloudflare has the Resend DKIM,
  `send` MX, and `send` SPF records.
- A Resend key named `Hidden Production` was created with **Sending access**
  restricted to `philippeho.dev`.
- On 2026-08-28 the key was transferred from the clipboard, and Resend accepted
  a message to its `delivered@resend.dev` simulator from
  `Hidden <no-reply@philippeho.dev>`.
- As of the 2026-09-02 read-only Coolify check, `RESEND_API_KEY` is empty again.
  The user said they retained it in a temporary text file. Transfer it again
  without showing it, verify the API call, then have the user delete that file.

### Cloudflare Turnstile

- The user created/configured a manual Managed widget named `Hidden Production`.
- Authorized hostnames shown in the dashboard:
  - `hidden.philippeho.dev`
  - `hidden-auth-staging.philippeho.dev`
- Pre-clearance is off.
- The user reached the generated Site Key and Secret Key screen. Neither value
  has been transferred to Coolify yet.
- Transfer the Site Key first to `VITE_TURNSTILE_SITE_KEY`, then the Secret Key
  to `TURNSTILE_SECRET_KEY`, using separate clipboard operations.

## Coolify production state

```text
Coolify app UUID:      jdsqr4mikup9mawl77fsnhc4
Application:           hidden
Production URL:        https://hidden.philippeho.dev
Tracked branch:        main
Current status:        running:healthy
Build pack:            Dockerfile
Replica/container:     exactly one
Production DB UUID:    bit0finr78bsbe8spo2fwq4d
Production DB:         hidden-postgres, PostgreSQL 16
Backup schedule UUID:  prtm1nl2aub3te4bh8bvfuys
```

Read-only variable state on 2026-09-02 (values were never printed):

| Variable | Current state | Required flags |
| --- | --- | --- |
| `BETTER_AUTH_URL` | nonempty | runtime only |
| `BETTER_AUTH_SECRET` | **empty** | runtime only, shown once |
| `AUTH_EMAIL_FROM` | nonempty | runtime only |
| `TRUST_PROXY_HOPS` | nonempty | runtime only |
| `RESEND_API_KEY` | **empty** | runtime only, shown once |
| `TURNSTILE_SECRET_KEY` | **empty** | runtime only, shown once |
| `VITE_TURNSTILE_SITE_KEY` | **empty** | build-time only, public |
| `DATABASE_URL` / `ALLOWED_ORIGINS` | existing production values | runtime only |
| `ADMIN_USERNAMES` | still present for the old live app | remove only during cutover |

Generate a fresh cryptographically random `BETTER_AUTH_SECRET` of at least 32
bytes and store it runtime-only. Do not try to recover the prior generated value;
it was never deployed.

### Coolify 4.1.2 API pitfalls discovered

- `POST /applications/{uuid}/envs` defaults new variables to build-time **and**
  runtime unless `is_runtime` and `is_buildtime` are explicitly supplied.
- Keep all provider/server secrets runtime-only. Only the public Vite Turnstile
  site key is build-time-only.
- The bulk env updater writes `NULL` to `is_shown_once` if that field is omitted,
  causing a database constraint error after partially processing the request.
- Prefer individual `PATCH /applications/{uuid}/envs` requests with the complete
  field set: `key`, `value`, `is_preview`, `is_literal`, `is_multiline`,
  `is_shown_once`, `is_runtime`, and `is_buildtime`.
- Never print `value`, `real_value`, request bodies, provider keys, or Coolify's
  bearer token. Validate only presence, shape, and flags.
- Environment updates create a normal “configuration has not been applied”
  warning. Do not rebuild until every required variable is valid.

## Backup and production data state

Read-only inventory on 2026-08-28:

```text
Latest migration: 004_user_last_seen
Users:             4
Matches:           0
Bookmarks:         0
```

Coolify's daily `03:00` backup schedule is enabled, S3-only, and had 30
successful R2 uploads. An extra S3 backup succeeded on 2026-08-27.

A separate local mode-600 dump was created and actually restored into disposable
PostgreSQL 16:

```text
/home/phil/app-data/hidden-backups/hidden-pre-cutover-20260827T145403Z.dmp
SHA-256: 840212088b0795032cd89bdad99080c6629c6bc184cccfa2c2cdc1b9c0d93031
Restored state: migration 004, users 4, matches 0, bookmarks 0
```

That dump is now old. Immediately before migration, record fresh counts, trigger
and confirm a fresh S3 backup, create a fresh local mode-600 `pg_dump --format=custom
--no-acl --no-owner`, and restore-test it inside a disposable `postgres:16-alpine`
container. Keep the prior application image identifier as well.

## Exact remaining sequence

1. Transfer the Turnstile Site Key from the user's explicitly authorized
   clipboard into `VITE_TURNSTILE_SITE_KEY`; verify nonempty/build-time-only;
   clear clipboard.
2. Transfer the Turnstile Secret Key separately into
   `TURNSTILE_SECRET_KEY`; verify nonempty/runtime-only/shown-once; clear
   clipboard.
3. Re-transfer the saved Resend key into `RESEND_API_KEY`; verify
   runtime-only/shown-once and send one Resend simulator message; clear clipboard.
4. Generate and store a fresh `BETTER_AUTH_SECRET` runtime-only/shown-once.
5. Verify all required Coolify variables by metadata only. Keep
   `ADMIN_USERNAMES` until the old app is retired.
6. Build a real isolated staging deployment/database at the already-authorized
   staging hostname. Test a real signup email, one-use verification and automatic
   sign-in, username/email login, recovery email/reset, guest play, WebSocket,
   history, and private-email boundary. Do not point staging at production data.
7. Refresh from `origin/main` if it moved. Run the full root suite, lint/build,
   all PostgreSQL integration tests, exact Linux Docker build, migrated-container
   health check, and browser happy path. Record results in
   `AUTH_IMPLEMENTATION.md`.
8. Follow the repository's integration workflow for `codex/better-auth` into
   `main`. Coolify tracks `main`; confirm whether the repository webhook will
   deploy immediately before merging/pushing.
9. At cutover, stop/isolate writes, take and restore-test the fresh backups,
   record counts and prior image, deploy exactly one replica, and run migration
   005 exactly once using `node server/dist/migrateCli.js` from the target image.
   The new server deliberately refuses to start on schema 004.
10. Confirm `/healthz`, guest play, registration, verification, username/email
    login, recovery, WebSockets, history, and public identity boundaries.
11. The user re-registers and verifies the administrator through the game. Then
    run:

    ```powershell
    npm run admin:role --workspace=hidden-server -- --user <username-or-email> --role admin
    ```

    Confirm admin access is database-backed, then remove obsolete
    `ADMIN_USERNAMES` from Coolify.

Rollback requires the prior application image **and** the fresh pre-cutover
database backup because migration 005 intentionally destroys legacy account
ownership and bookmarks.
