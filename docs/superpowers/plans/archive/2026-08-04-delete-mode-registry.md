# Mode registry removal outcome

Status: shipped 2026-08-05.

## Problem

The obsolete registry, `MatchRules`, and legacy `{ mode, rules }` compatibility
shape remained after every runtime caller had moved to engine plus config. Dead
tests included assertions that passed by comparing missing properties.

## Shipped solution

- Migrated remaining test callers to `{ engine, config, seed, firstSeat }`.
- Deleted the registry, legacy decoders/defaults, compatibility shim, dead web
  module, and vacuous assertions.
- Added test-only TypeScript configurations so game-core and server tests are
  typechecked without being emitted into production.

## Lasting constraints

- Engine revision did not change because runtime behavior did not change.
- `ClassicMode`, topology construction, config helpers, and `ResolvedGameSpec`
  remain live engine concepts, not registry leftovers.
- Numeric packets and gameplay were untouched.
