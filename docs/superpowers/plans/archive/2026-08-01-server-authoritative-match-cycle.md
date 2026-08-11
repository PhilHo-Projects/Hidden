# Server-authoritative match cycle outcome

Status: shipped.

## Problem

Clients resolved canonical gameplay, so seats, commands, clocks, scoring, and
completion could diverge or be spoofed.

## Shipped solution

- Added the root workspace and deterministic `@hidden/game-core` shared by
  offline play, server, and online client projection.
- Added `MatchCoordinator` ownership of rooms, state, revisions, deadlines,
  deduplication, finish, rematch, and disconnect cleanup.
- Added revisioned command/update packets 19 and 20 without renumbering existing
  packets.
- Covered engine parity and trust boundaries in core, server, web, and real
  WebSocket tests.

## Lasting constraints

- Sender seat comes from the connection.
- Timeout commands remain in the deterministic command stream.
- Active matches are process-local; production stays at one replica.
