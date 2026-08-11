# Game configuration parameterization outcome

Status: shipped.

## Problem

Balance experiments required compiled mode entries and hardcoded 3x3 rendering.

## Shipped solution

- Introduced engine identity plus a complete per-match `GameConfig`.
- Added tolerant decoding, clamping, generated 3x3-5x5 square topology, and
  config-driven power-up behavior.
- Migrated offline practice, online protocol/adapters, hosted matches, and board
  rendering to the same config.
- Preserved the original default game and 3x3 pattern order with characterization
  tests; fixed linked CommonJS core handling in Vite development.

## Lasting constraints

- Engine behavior is versioned; balance values travel as config.
- Streak unlocks power-ups and is not the winner condition.
- Default config must reproduce the published classic game.
- Non-turn and irregular-topology modes require separate designs.
