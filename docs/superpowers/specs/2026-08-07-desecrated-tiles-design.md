# Desecrated tiles decision

Status: shipped in classic engine revision 2.

## Problem

Immediate conflict resolution reveals a contested cell. Replaying that cell on
the next turn was cheap and could trap both players in a repeated trade loop.
The optional `forbidImmediateRepeat` rule targeted the last placement instead
of destruction and failed during extra turns.

## Decision

- A destroyed piece leaves its owner's cell desecrated and unplayable for
  exactly one owner turn. The rule is unconditional in offline, Quick Match,
  public, and private games.
- `desecratedTurns` starts at 2 because destruction occurs after the current
  turn's decrement: the next owner turn changes 2 to 1, and the following turn
  changes 1 to 0.
- Placement, automatic passing, timeout choices, and extra-turn placement all
  use the same playable-cell predicate.
- The obsolete no-repeat config, state, rejection reason, and UI control were
  removed.

## Lasting constraints

- This changed placement legality and therefore required engine revision 2.
- The wire protocol did not change; clients derive the same board state by
  applying authoritative commands through the shared core.
- Engine, view, and CSS names remain separate:
  `desecratedTurns`, `CellState.desecrated`, and
  `.hidden-cell-desecrated`/`--cell-desecrated-fill`.
- Desecration interrupts immediate reuse but does not remove the information
  leak. Simultaneous resolution remains a separate, playtest-driven decision.
