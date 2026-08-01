# Server-Authoritative Match Foundation Design

## Purpose

Build the foundation for trustworthy online matches without prematurely taking
on persistence, replay, private lobbies, or experimental boards. This design
covers roadmap milestones 1-3 and lifecycle stages 1-6: land authoritative
match rules, extract one deterministic `classic-v1` engine, then make Quick
Match accept commands and resolve them on the server.

The rules-authority prerequisite shipped in PR #2. It makes online rules and
the ready/rematch handshake authoritative, but the clients still resolve moves,
power-ups, scoring, and completion. This design closes that boundary.

## Architecture

The repository becomes a private npm workspace with `web`, `server`, and a
dependency-free CommonJS TypeScript package at `packages/game-core`. The core
is seat-neutral and owns board state, turns, conflicts, power-up legality and
effects, deterministic randomness, timeouts, scoring, and results. React owns
only presentation state; the WebSocket layer owns only transport and identity.

`classic-v1` is an immutable compiled mode. Its logical board is described by
stable location IDs and pattern/topology data rather than `Array(9)` and a
global `WIN_LINES`. No alternate mode ships in this slice.

Quick Match and future private discovery converge on one room factory. A room
holds trusted participants, resolved rules, and readiness. Each ready cycle
creates a fresh transient run with a UUID match ID, `classic@1`, a uint32 seed,
first seat, canonical state, revision, deadline, and command cache.

## Shared core contract

```ts
type Seat = 0 | 1
type LocationId = number
type ClassicSymbol = 'rock' | 'paper' | 'scissors'
type PowerupKey = 'shield' | 'reveal' | 'extraTurn'

interface ModeRef { id: 'classic'; revision: 1 }
interface GameSpec {
  mode: ModeRef
  rules: MatchRules
  seed: number
  firstSeat: Seat
}

type GameCommand =
  | { type: 'place'; locationId: LocationId; symbol: ClassicSymbol }
  | { type: 'activate-powerup'; powerup: PowerupKey }
  | { type: 'select-shield-target'; locationId: LocationId }
  | { type: 'timeout' }
```

The package exports `createGame`, `applyCommand`, `applyTimeout`, `GameState`,
`DomainEvent`, `MatchRules`, and the immutable mode registry. It uses the
versioned `mulberry32-v1` random algorithm. Identical specs and command streams
must produce identical states and events without mutating input state.

Classic behavior remains unchanged except for two authority rules:

- Online clocks are placement-window deadlines. UI selection and power-up
  setup cannot reset them; an accepted first extra-turn placement opens one
  fresh placement window.
- If the active player has no legal placement, the engine emits `turn-passed`,
  consumes the turn, and scores normally at the configured limit.

## Server lifecycle and trust

`GameHandler` retains sockets, connection limits, payload/rate validation,
heartbeat, trusted connection identity, and packet routing. A focused
`MatchCoordinator` owns discovery, room/run phases, canonical state, command
validation, deadlines, and cleanup.

The actor seat always comes from the connection-owned session. Packet sender
IDs, roles, seats, scores, board states, and winners are never authoritative.
Before processing an incoming command, the coordinator resolves any expired
deadline so delayed timer callbacks cannot create a grace-period exploit.

Exact duplicate commands resend the cached actor response without reapplying.
Reusing a command ID with different content is rejected. Rule-level rejection
does not disconnect; malformed MessagePack retains the existing policy close.
Finished runs reject new game commands. Disconnect abandons the transient room
and cancels its timer. `AGAIN?` reuses the ready handshake and room rules while
creating a fresh transient run ID.

## Protocol

All active packet numbers remain frozen. `GAME_START` remains packet 15 and
keeps `firstPlayerId` in its current position while appending a keyed descriptor
with match ID, mode revision, seed, initial revision, and remaining turn time.

Two new packet numbers are appended:

- `GAME_COMMAND = 19`: `{ matchId, commandId, expectedRevision, command }`.
- `GAME_UPDATE = 20`: accepted updates include revision range, actor seat,
  canonical command batch, domain effects, and remaining time; rejected updates
  include command ID, current revision, and a stable reason code.

The online client waits for acceptance before changing canonical board state.
It applies accepted batches through the same core. A revision gap or unknown
mode fails closed to a sync-lost screen; recovery is deferred. The first
extra-turn placement is confirmed to its actor and buffered for the opponent,
then both placements are delivered as one revision range after the second.

Opponent move details remain inspectable on the wire as today. Blind mode is
still presentation-only until per-player projections are designed.

## Verification and rollout

Tests are written before runtime changes. Core characterization and parity
tests cover conflicts, immunity, all power-ups, extra turns, timeouts, passing,
rounds, scoring, determinism, immutability, invalid commands, and topology-driven
construction. Server tests cover trusted seats, lifecycle, spoofing, revisions,
deduplication, deadlines, illegal actions, finish locking, disconnects, and
rematches. Client tests cover server-confirmed state, rejection, timers, update
application, and fail-closed gaps. Two-WebSocket tests complete a real match.

The shared-core migration is delivered and merged separately because it should
have no intended gameplay change. The authority migration ends at a verified
draft PR and is not deployed by this plan.

## Roadmap

1. **Complete:** land and deploy online rules authority.
2. **Current:** extract `classic-v1` into the shared deterministic core.
3. **Current:** make Quick Match server-validated and server-resolved.
4. **Deferred:** route Create/Find Game and private codes through the room factory.
5. **Deferred:** persist matches, participants, mode revisions, and events.
6. **Deferred:** build history, stats, and a developer replay inspector.
7. **Deferred:** prove extensibility with a 4x4 mode.
8. **Deferred:** test versioned balance variants for repeated-square play.
9. **Deferred:** add hex and irregular topology experiments.

Lifecycle stages 7-9—durable sequenced events/snapshots, authoritative finish
records, and reconnect/rematch lineage—require a separate design discussion.

