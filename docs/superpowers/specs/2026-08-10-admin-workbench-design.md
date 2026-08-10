# Admin workbench design

Date: 2026-08-10

## Purpose

Hidden needs one safe place for its operators to inspect the live service and
the data it already stores. The first version is intentionally read-only. It
creates a service boundary and a stable workspace before moderation, research
annotations, retention tools, or public player counts are designed.

The only configured administrator usernames are `VinceAdmin` and `PhilAdmin`.
Their role is still derived from `ADMIN_USERNAMES`; no account ID or role is
stored in PostgreSQL and no username is privileged by client code.

## Access boundary

The profile menu renders **Admin workspace** only when the authenticated session
reports `role: "admin"`. The account control remains locked during matchmaking,
ready, countdown, battle, and results, so the workbench cannot cover or disrupt
an active match.

Visibility is convenience, not authorization. Every `/api/admin` request reads
the browser session again and returns structured `401`, `403`, `400`, `404`, or
`503` errors. All responses carry `Cache-Control: no-store`. Admin DTOs are
separate from WebSocket and game-state contracts and exclude credential hashes,
session hashes, and packet bodies.

## Workspace

The workbench is a native, near-full-screen dialog with a compact top tablist:

- **Stats** is the default. It polls every ten seconds only while the dialog and
  tab are visible. Process-local counts and PostgreSQL totals are visually and
  semantically separate.
- **Matches** is a newest-first, 50-row keyset ledger. Desktop keeps a persistent
  detail inspector beside the table. Phones move from the list to a full detail
  view with an explicit back action.
- **Accounts** is a read-only, newest-first keyset table with username-prefix
  search, derived role, session recency, active sessions, and match count.
- **Console** executes only `help`, `status`, and `clear` through a client-side
  allowlist. It has no SQL, shell, eval, destructive RPC, or free-form server
  command channel.

The dialog closes through Escape, its close control, or a backdrop press and
lets the browser restore focus to the profile trigger. Tabs support Left/Right
arrow keys. Every data surface has loading, empty, retry, and expired-session
states.

## Snapshots are not replays

The global match view reads the same durable v1 records used by participant
history. Those records contain participants, account references, completion
time, engine and rules identity, turn count, scores, winner, bookmark count,
and final boards. They do not contain the ordered commands or seed required to
reconstruct play. The interface therefore says **Matches** and **snapshots**, not
replays, and offers no playback controls.

## Runtime statistics

The game handler exposes a reusable count provider covering connections, named
players, authenticated and guest players, queue membership, pending lobbies,
and active matches. The admin route combines that process-local snapshot with
account, active-session, and stored-match totals. A future public endpoint may
reuse only the appropriate online-player fields rather than exposing the admin
response.

Production remains exactly one replica. The runtime counts are not cluster-wide
until matchmaking and active state move to shared storage.

## Provisioning

The compiled provisioner takes repeated usernames as command arguments and the
shared password through non-interactive standard input. It validates every
existing account before inserting anything, then commits both names together.
New accounts receive independently salted Argon2id hashes and no sessions.
Matching reruns succeed; a conflicting password aborts without partial writes.

The password must never appear in the repository, command arguments, logs, or a
long-lived deployment variable. Provision first, remove temporary secret
material, then enable the exact allowlist and redeploy.
