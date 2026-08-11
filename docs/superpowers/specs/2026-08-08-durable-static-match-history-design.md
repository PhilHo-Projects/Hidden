# Durable static match history decision

Status: shipped.

## Problem

Rule-discovery sessions needed durable evidence, but executable replay was
premature because old engine implementations are not retained.

## Decision

- Store one immutable version-1 final snapshot for each completed authoritative
  online match, keyed by server match UUID. Offline and abandoned games are not
  recorded.
- Persist completion time, turn count, opaque engine/config identity, scores,
  winner, participant name/account snapshots, and ordered symbol-only final
  boards. Exclude seed, commands, timing, immunity, desecration, and live
  power-up state.
- Emit completion once. A bounded asynchronous recorder performs three total
  attempts, at most four writes concurrently, admits at most 256 records, logs
  no payloads, and drains admitted work on graceful shutdown.
- Signed-in participants receive private perspective-aware totals, keyset pages,
  detail, and per-account Interesting bookmarks. Guests receive 401;
  nonparticipants receive 404.

## Lasting constraints

- Persistence failure never delays or changes game-over delivery.
- Account deletion may clear ownership but retains the historical name snapshot.
- One authenticated account cannot occupy both match seats.
- History DTOs are independent of live engine unions; unknown symbols remain
  visible as text.
- A page size is not a retention limit. Replay, public sharing, annotations,
  deletion, and R2 remain separate designs.
