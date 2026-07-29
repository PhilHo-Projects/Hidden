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
Accounts are not implemented. Quick Match is the only available online mode;
Create Game and Find Game remain visible as clearly unavailable future modes.

## Hierarchy and status

- HIDDEN is a compact masthead with visible black-brush space around the word.
- Action labels stay contained inside their brush artwork and may include one
  short explanatory sentence.
- Every non-landing screen uses one slim persistent bar: contextual Back on the
  left, live status in the center, and the account slot on the right.
- Guest sessions show Sign In in the account slot. A future authenticated
  session replaces it with profile/settings access.
- Back returns one decision at a time. Battles and results return to their
  relevant online menu or offline setup; repeated Back eventually reaches the
  landing screen.
- Navigation actions use the yellow brush voice while status copy stays compact
  and utilitarian.
- Status copy reflects the actual phase: connecting, syncing, joining,
  searching, match found, ready, or failed.
- Gameplay turn state and temporary announcements belong in the battle header.

## Portrait-phone rules

- Design the pre-game flow for an upright phone from 320 px wide.
- Stack choices vertically and keep the primary path within easy thumb reach.
- Respect device safe areas and use `100dvh` where viewport height matters.
- Interactive targets must be at least 48 px tall.
- Fixed controls must not cover actions, status, or form fields.
- Keep the battle interaction in one vertical sequence: board, powerups, then
  rock/paper/scissors. The three powerups and three move choices remain visible
  as compact rows instead of becoming detached edge controls.

## Battle feedback

- Reveal opens the opponent board as a compact temporary overlay; it must not
  resize or replace the player's board.
- A destroyed player square uses a sharp red impact and collapse. Destroying an
  opponent square uses a cyan/yellow burst at the corresponding battle cell.
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

Account registration, login, persistence, private-room creation, game lookup,
reconnection, and shared matchmaking state require separate product and backend
work. Their unavailable entry points must not imply that those systems already
exist.
