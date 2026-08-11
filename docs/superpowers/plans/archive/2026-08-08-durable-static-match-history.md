# Durable static match history outcome

Status: shipped 2026-08-09.

## Problem

Completed matches vanished on deploy, while executable replay was too early for
an engine whose mechanics were still changing.

## Shipped solution

- Added versioned, idempotent PostgreSQL final snapshots for completed
  authoritative online matches.
- Added a bounded asynchronous recorder with safe retries, payload-free logs,
  and graceful-shutdown draining.
- Added authenticated participant history, perspective totals, keyset pages,
  static final boards, and private bookmarks.
- Verified repository behavior with PostgreSQL 16 and a real two-account match.

## Lasting constraints

- Game-over delivery never waits for persistence.
- Guests are recorded but cannot browse personal history.
- Snapshots are not replay and never execute through `game-core`.
- Public sharing, retention, notes, deletion, and R2 remain separate work.
