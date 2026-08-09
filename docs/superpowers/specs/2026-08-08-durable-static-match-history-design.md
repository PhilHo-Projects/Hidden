# Durable static match history

Date: 2026-08-08.

## Purpose

Hidden is entering a rule-discovery phase. Full command replay is deliberately
premature because the current build retains only one engine implementation, so
an engine revision identifies old behaviour without providing code that can
still execute it.

This feature records a mechanics-independent final snapshot instead. A signed-in
participant can revisit how a completed online match ended without replaying it
through `game-core`. The record also preserves opaque engine and config context
for later research.

## Stored record

PostgreSQL stores one immutable version-1 record per completed online match,
keyed by the server-assigned match UUID. It contains:

- completion time and final turn count;
- engine ID/revision and an opaque config snapshot;
- winner seat and both scores;
- two participant snapshots with seat, displayed username, and optional account
  ID;
- two final boards reduced to captured column count and ordered
  `{ locationId, symbol }` cells.

Mechanical display state such as immunity, desecration, power-up state, commands,
seed, and move timing is absent. Historical symbols are strings rather than the
live engine union so future clients can render an unknown value as text.

Only completed server-authoritative online matches are recorded. Offline and
abandoned matches are not. Guest-versus-guest matches are retained for a future
admin research view even though neither guest has an account history page.

## Persistence

`MatchCoordinator` emits one frozen completion snapshot when a run first enters
`finished`. A recorder inserts it asynchronously with the match UUID as the
idempotency key. Persistence never delays or alters the authoritative game-over
update.

A failed insert receives two bounded retries. Failures log only the match ID and
error class, never config or board contents. The recorder runs at most four
inserts concurrently and admits at most 256 active or queued writes. If that
capacity is exhausted, the record is dropped with the same payload-safe logging
contract rather than blocking game completion. Graceful shutdown waits for all
admitted record attempts before closing the PostgreSQL pool.

Participants and bookmarks are separate relations. Deleting an account sets a
participant account ID to null but retains its historical username. Each account
has its own Interesting bookmark for a match.

An authenticated account cannot occupy both seats: Quick Match skips its other
connections and hosted games reject them as the host's own game. This preserves
one perspective per account while still allowing anonymous guest seats.

## Account API

All history endpoints require the existing session cookie and return
`Cache-Control: no-store`.

- `GET /api/history` returns Played/Wins/Losses/Ties, 20 newest perspective-aware
  summaries, and an opaque keyset-pagination cursor. `bookmarked=true` filters to
  the caller's Interesting matches.
- `GET /api/history/:matchId` returns full final snapshots only when the caller
  was an authenticated participant.
- `PUT /api/history/:matchId/bookmark` accepts `{ "bookmarked": boolean }` and is
  protected by the existing allowed-origin/JSON rules.

Nonparticipants receive 404 so match UUID existence is not disclosed. Account
IDs never leave the server.

## Interface

The existing Match history profile entry becomes active for every signed-in
account. It opens a full screen and remembers the screen it came from.

The screen shows Played/Wins/Losses/Ties, All and Interesting filters, and a
newest-first list. Each row contains opponent, outcome, score, completion time,
and the caller's bookmark state. Twenty is a page size, never a retention cap.

Selecting a row opens an inline detail view with names, score, date, and two
read-only final boards. Loading, empty, session-expired, retryable-error, unknown
symbol, load-more, and bookmark rollback states are explicit.

## Deferred

There is no executable replay, public sharing, admin-global view, notes,
retention, deletion, storage dashboard, R2 integration, or deployment in v1.

The future chess-style replay will record ordered actions, acting player, action
duration, and power-up events only after mechanics stabilize. The future admin
research console will browse all matches, collect interesting examples, report
PostgreSQL record/index size, and provide guarded cleanup. R2 remains optional
blob storage if those later timelines become large; PostgreSQL remains the
search index.
