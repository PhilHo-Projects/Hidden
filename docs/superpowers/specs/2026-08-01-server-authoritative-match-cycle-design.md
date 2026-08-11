# Server-authoritative match foundation decision

Status: shipped.

## Problem

Clients previously resolved moves, power-ups, clocks, scoring, and completion.
That made spoofing, divergence, and trustworthy match records impossible.

## Decision

- `@hidden/game-core` is a dependency-free deterministic engine shared by
  server and browser. Identical engine/config/seed/command inputs produce the
  same immutable state transitions and domain events.
- `MatchCoordinator` owns rooms, trusted seats, canonical state, revisions,
  deadlines, command deduplication, finish locking, rematch, and cleanup.
- `GameHandler` owns sockets, limits, heartbeat, trusted identity, decoding, and
  delivery only.
- Clients submit revisioned commands and change canonical online state only
  after accepted server updates.
- `GAME_COMMAND = 19` and `GAME_UPDATE = 20` were appended without renumbering
  existing packets. Revision gaps fail closed to sync-lost.

## Lasting constraints

- Actor seat always comes from the connection-owned participant.
- Timeout commands remain explicit because they consume seeded RNG.
- Duplicate command IDs with identical content replay the cached response;
  reuse with different content is rejected.
- Finished runs reject commands. Disconnect abandons the process-local room and
  cancels its timer.
- The current coordinator is classic and turn-oriented. Authority infrastructure
  can support another engine, but incompatible timing needs a new lifecycle
  contract rather than changes to the published classic revision.
- Production remains one replica until active state and reconnect are shared.
