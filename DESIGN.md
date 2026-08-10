# Hidden Design Guide

## Product direction

Hidden should feel immediate, rough-edged, and game-like without carrying Unity
scene conventions into the browser. The background, paint, brush textures, and
yellow wordmark are the visual identity; interface chrome should stay quieter
so the next action is always obvious.

## Entry flow

The pre-game path is staged:

1. Choose sign-in or guest play.
2. Choose online or offline play.
3. Choose an available mode or configure practice.
4. Connect, ready up, and enter the match.

Guest play generates an in-memory `Guest#NNNN` name for the current page load.
Accounts persist in PostgreSQL and are optional: guests can queue, host, and
join. Quick Match, Create Game, and Find Game are all available. Only the Quick
Match rules panel is account-gated, and only to admins, because a proposal
there binds a stranger; a host sets the rules of a game they own.

## Hierarchy and status

- HIDDEN is a compact masthead with visible black-brush space around the word.
- Action labels stay contained inside their brush artwork and may include one
  short explanatory sentence.
- Every non-landing screen uses one slim persistent bar: contextual Back on the
  left, live status in the center, and the account slot on the right.
- Guest sessions show Sign In in the account slot. Authenticated sessions use a
  profile disclosure with match history and account actions. Administrators
  additionally see the restricted Admin workbench entry whenever the current
  match phase allows account navigation.
- Back returns one decision at a time. Battles and results return to their
  relevant online menu or offline setup; repeated Back eventually reaches the
  landing screen.
- Navigation actions use the yellow brush voice while status copy stays compact
  and utilitarian.
- The brush face carries every display heading: the masthead, panel titles, the
  round callout, and the game-over verdict. In a match it also carries the turn
  line and the player name above a board — the two things looked at most while
  playing, which in the block face read as chrome reporting on the game rather
  than as the game speaking. The block face keeps status copy, labels,
  descriptions, scores, and clocks. A single panel never runs both faces at
  headline size.
- The turn line names the opponent by role, not by name: it is read at a glance,
  and a long name wrapped it. The name is already in the top bar and above the
  opponent's own board.
- The persistent bar owns no surface of its own. Its status panel is
  transparent, so the bar reads as one black strip rather than a box on a strip.
- Status copy reflects the actual phase: connecting, syncing, joining,
  searching, match found, ready, or failed.
- Gameplay turn state and temporary announcements belong in the battle header.

## Match history

- History is a private ledger for a signed-in participant, not a replay and not
  a stats dashboard. One ruled surface carries totals, filters, rows, and final
  board detail instead of splitting each datum into a separate card.
- Rows lead with outcome, opponent, score, and completion time. The star is an
  independent 48 px target for the account's personal **Interesting** bookmark;
  it must never imply a shared or public collection.
- The All / Interesting switch keeps the same W/L/T totals. Pagination appends
  newer-to-older pages; an empty filtered list explains how to add a bookmark.
- Detail is read-only and mechanics-independent: participant names, final score,
  completion date, and both final boards. Known classic symbols use their board
  colours; an unknown future symbol renders as legible text.
- Loading uses a quiet skeleton. Expired sessions, retryable list/detail errors,
  empty history, pagination errors, and bookmark rollback each have distinct
  recovery copy.
- Opening history remembers the exact screen under it. Global Back returns to
  that screen; the detail's local All matches control returns to the ledger.

## Admin workbench

- The workbench is a read-only operational surface for allowlisted
  administrators. It opens as a near-full-screen native dialog over the current
  pre-game screen and returns focus to the profile control when dismissed.
- Stats is the default view. Matches and Accounts use dense ledger tables rather
  than collections of cards; Console is an allowlisted client command registry,
  never a shell, SQL prompt, evaluator, or destructive remote control.
- Match rows open a persistent final-state inspector beside the ledger on wide
  screens. On portrait phones the list remains the entry view and selection
  moves into a dedicated detail view with an explicit return control.
- Stored matches are final snapshots: participants, score, final boards, rules,
  and completion metadata. The interface must not label them as playable
  replays until ordered command recording and deterministic playback exist.
- Operational counts refresh only while the visible Stats tab is open. Loading,
  empty, retryable failure, and expired-session states stay inside the dialog
  and never expose password hashes, session hashes, or packet bodies.

## Portrait-phone rules

- Design the pre-game flow for an upright phone from 320 px wide.
- Stack choices vertically and keep the primary path within easy thumb reach.
- Respect device safe areas and use `100dvh` where viewport height matters.
- Interactive targets must be at least 48 px tall.
- Fixed controls must not cover actions, status, or form fields.
- Phone chrome shows the phase label alone. Detail copy is dropped rather than
  ellipsed, because the screen below already restates it; wider viewports keep
  the full line. Error detail is the exception and always stays visible.
- Screens shorter than the viewport centre in the leftover height instead of
  sitting under the bar, and fall back to top alignment once they overflow.
- Keep the battle interaction in one vertical sequence: board, powerups, then
  rock/paper/scissors. The three powerups and three move choices remain visible
  as compact rows instead of becoming detached edge controls.

## Battle feedback

- Reveal opens the opponent board as a compact temporary overlay; it must not
  resize or replace the player's board.
- Anything that lands on a cell grows from its middle, and anything that leaves
  shrinks back into it. Colour and desecration both read the shared
  `--cell-motion-*` tokens, so the two cannot drift into different motion for the
  same event; the out curve is the in curve reversed, which is what keeps the
  longer exit from reading as lag. Colour is a layer over the cell rather than
  the cell's own background, because a background can neither grow from the
  centre nor outlive the cell it belonged to. A board that mounts with its ink
  already down — results, the revealed opponent peek — never replays it.
- A destroyed player square uses a sharp red impact and collapse. Destroying an
  opponent square uses a cyan/yellow burst at the corresponding battle cell.
- The destroyed cell then reads as desecrated brown until its owner's next turn,
  when it shrinks back out the way it came. The whole look is
  `--cell-desecrated-fill` and
  `animations/cell-desecration.css`, so replacing it with a texture is a CSS
  change alone.
- These effects are cosmetic engine events only. They do not change public
  multiplayer packets or server behavior.
- Final boards stay paired on portrait screens when each cell can retain a
  comfortable readable size; the game-over summary remains compact above them.
- Result boards omit the repeated "Final Board" label. Occupied cells brighten
  in score order and receive numbered badges so the final score can be audited
  directly against the board.

## Practice setup

- Practice setup leads with one concise gray description and the primary Start
  action.
- Advanced rules are a centered disclosure below Start; opening it keeps the
  existing rounds, timer, and blind-mode controls inline.

## Motion direction

Navigation motion is deliberately deferred. A later pass may use a 180–220 ms
directional crossfade with slight vertical drift for ordinary navigation and a
single brief black-brush wipe when entering a match. Reduced-motion users
receive a plain crossfade or an immediate state change.

Reusable visual effects live under `web/src/animations/`. Each effect owns its
React wrapper and imported CSS choreography, is exported through the folder
index, ignores pointer input, and supplies a reduced-motion state. Individual
screens own only the effect's placement and when it appears.

## Deferred systems

Chess-style action replay, public sharing, admin moderation and destructive
actions, public online counts, reconnection, and shared matchmaking state
require separate product and backend work. Their unavailable entry points must
not imply that those systems already exist.
