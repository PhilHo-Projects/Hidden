# App shell extraction outcome

Status: shipped 2026-08-11.

## Problem

`App.tsx` held navigation plus 29 state values, refs, effects, networking, lobby,
account, countdown, and match lifecycle logic in one scope. The render blocks
were already small; splitting them would only have created wide prop surfaces.

## Shipped solution

- Extracted `useDestructionEffects`, `useLobbyBrowser`, `useAccountSession`, and
  `useMatchSession` in ascending risk order.
- Kept screen composition and navigation in `App.tsx`, reducing it from 1,641
  to 870 lines.
- Preserved stable callback/ref patterns, terminal-screen ordering, guest
  fallback, sockets, gameplay, packet shapes, and offline bot behavior.
- Verified root tests, lint, build, offline browser flow, and focused match-hook
  network edge cases.

## Lasting constraints

- Stateful ownership belongs in hooks; screen markup stays together while its
  prop boundary would be wider than the screen itself.
- `useMatchSession` is intentionally the authoritative client lifecycle seam.
- CSS and gameplay rules were not part of this extraction.
