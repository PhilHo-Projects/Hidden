# Configurable classic engine decision

Status: shipped; this record describes the current architecture after removal
of the original mode registry.

## Problem

Every balance experiment was a new compiled mode revision. That made harmless
board or toggle changes expensive and risked making stored games reconstruct
differently when old registry entries were edited.

## Decision

- Version executable behavior on the engine (`ENGINE_ID` and
  `ENGINE_REVISION`), not on individual balance variants.
- Store a complete `GameConfig` with each match. It carries board size, streak,
  rounds, turn seconds, blind mode, the power-up master switch, and individual
  power-up toggles.
- `createTopology(boardSize, streak)` generates square 3x3-5x5 location IDs and
  ordered row/column/diagonal windows. The default 3x3 topology is pinned to the
  original pattern order.
- `createGame` accepts only `{ engine, config, seed, firstSeat }`; the registry,
  `MatchRules`, and legacy compatibility shape are gone.
- Config decoding is tolerant per field and clamping is deterministic. Online
  turn time has a stricter minimum than offline rapid iteration.
- React renders from topology and view projection rather than hardcoded nine-
  cell assumptions.

## Versioning rule

Config-only variation does not bump the engine. Any change to command legality,
placement/conflict resolution, scoring, or seeded RNG publishes a new engine
revision. Never edit a published revision in place.

## Current boundaries

- Streak controls power-up unlocking, not the winner. The winner is determined
  by surviving-cell score at the configured turn limit.
- Static history stores final snapshots and opaque engine/config identity; it
  is not replay.
- Non-square topology and non-turn timing are separate engine-design problems.
  They must not be represented as extra flags on the classic config.
- Simultaneous conflict resolution remains conditional on playtest evidence
  because it changes extra-turn, shield, timeout, and delivery semantics.
