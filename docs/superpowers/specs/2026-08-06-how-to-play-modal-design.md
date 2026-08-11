# How to Play decision

Status: shipped.

## Problem

New players reached the board without an explanation of hidden information,
rock-paper-scissors conflicts, scoring, or power-up unlocking. Copy tied to a
specific board or streak would become false during balance experiments.

## Decision

- Provide an accessible modal explaining only config-independent concepts:
  hidden opponent board, conflict resolution, surviving-cell scoring, and line-
  based power-up unlocking.
- Keep exact board size, streak length, rounds, and symbol-to-power-up mapping
  out of the copy.
- Use a labelled modal dialog that closes by its control, Escape, or backdrop;
  move focus inside on open and restore it to the trigger on close.
- Ship the cropped WebP help icon rather than the large concept master.
- Use brush type for the turn line and player names so gameplay speaks in the
  same voice as round and result headings.

## Lasting constraints

- The modal changes presentation only; it never touches engine or packets.
- The trigger must retain an accessible name and 48 px target.
- Any rules-copy change must be checked against every supported `GameConfig`.
- Reduced-motion behavior and phone-safe dialog overflow remain required.
