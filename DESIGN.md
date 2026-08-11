# Hidden design guide

This file describes the interface as it should behave now. Product priorities
and future systems belong in `docs/ROADMAP.md`; implementation history belongs
in `docs/JOURNAL.md`.

## Product direction

Hidden should feel tactile, fast, and legible before it feels feature-rich. The
black, white, yellow, red, blue, green, and desecrated-brown palette is the
identity. Brush type speaks for the game; compact block type carries controls,
status, descriptions, scores, and clocks.

Rules are still being tested. Interface copy should explain stable concepts
rather than hardcode a board size, streak length, round count, or symbol-to-
power-up mapping that a `GameConfig` can change.

## Flow and navigation

1. Choose sign-in or guest play.
2. Choose online or offline play.
3. Choose Quick Match, host/join, or configure practice.
4. Ready, count down, play, and review the result.

- Back returns one decision at a time. Battle and result exits return to the
  relevant online or offline entry point.
- The persistent bar owns navigation and connection phase. Match turns and
  temporary announcements belong in the battle header.
- Account/history/admin controls are unavailable while matchmaking, ready,
  countdown, battle, or results could be disrupted.
- Status text must reflect the real phase: connecting, searching, syncing,
  joining, ready, active, failed, or disconnected.

## Type and controls

- Brush type is reserved for the masthead, screen headings, round/result
  callouts, turn line, and player names above boards.
- Block type carries labels, descriptions, status, scores, codes, tables, and
  timers. One panel should not use both faces at headline size.
- Primary actions use the yellow brush treatment. Destructive or exit actions
  may use red; unavailable actions remain visibly disabled.
- Interactive targets are at least 48 px tall and have visible keyboard focus.

## Responsive layout

- Design pre-game screens from 320 px portrait width upward.
- Respect safe areas and use `100dvh` where viewport height matters.
- Stack choices before shrinking their touch targets. Fixed controls must not
  cover actions, status, or form fields.
- Phone chrome keeps the phase label and hides redundant non-error detail.
  Error detail remains visible.
- Short screens center in available height when they fit and use safe top
  alignment when they overflow.
- Battle remains one vertical sequence: board, power-ups, then move choices.

## Practice and onboarding

- Practice leads with one short description and the Start action. Advanced
  rules remain a disclosure below it.
- How to Play is an accessible modal that explains hidden boards, conflict
  resolution, scoring, and config-independent power-up unlocking.
- Dialogs close through their close control, Escape, or backdrop press, move
  focus inside on open, and return focus to their trigger.

## Battle and board feedback

- Reveal uses a compact temporary opponent-board overlay and never resizes the
  player's board.
- Pieces enter from and leave toward the center of their cell. Results and
  already-revealed boards mount in their final state without replaying effects.
- Player destruction uses the red impact/collapse treatment; opponent
  destruction uses the cyan/yellow burst.
- A destroyed location becomes desecrated brown until the engine releases it.
  Motion tokens in `styles/foundation.css` and effect CSS must stay aligned.
- Power-ups and moves remain visible as compact rows on phones.
- Final boards stay paired while cells remain readable. Occupied result cells
  brighten in score order and show numbered badges so the score is auditable.

## History and admin

- Match history is a participant-owned ledger: totals, filters, newest-first
  rows, final-board detail, and private Interesting bookmarks.
- Stored matches are snapshots, not replays. Never show playback controls until
  ordered command recording and deterministic playback exist.
- The admin workbench is read-only and visually separates process-local counts
  from PostgreSQL totals. Matches and Accounts use dense ledgers on desktop and
  explicit list/detail navigation on phones.
- Admin Console is an allowlisted client command surface, never shell, SQL,
  evaluation, moderation, or arbitrary RPC.

## Motion and effects

Reusable effects live under `web/src/animations/`. Each owns its React wrapper,
CSS choreography, pointer behavior, and reduced-motion state. Screens decide
only where and when an effect appears.

Navigation motion remains deferred. Any later pass should use a short
directional crossfade and provide an immediate or plain-crossfade reduced-
motion path.

## Unavailable systems

Executable replay, public sharing, moderation, destructive admin actions,
reconnect, and cluster-wide matchmaking are not present. The interface must not
show controls that imply otherwise.
