# How-to-play modal and battle type voice

Date: 2026-08-06.

## Why

Nothing in the app explains the game. A new player reaches the board with no
idea that the opponent's board is hidden, that a square is contested by rock,
paper, scissors, or that lines unlock power-ups. The rules are also still being
tuned, so the explanation has to survive rule changes without being rewritten.

Two smaller battle-screen fixes ride along: the turn line and the player name
are the two things a player looks at most during a match and both are currently
set in the block face, which reads as chrome rather than as the game speaking.

## What ships

### 1. A how-to-play modal

New `web/src/components/HowToPlayModal.tsx`. The first modal in the app, so it
establishes the pattern:

- `role="dialog"` with `aria-modal="true"` and a labelled heading.
- Closes on the close button, on Escape, and on a backdrop press.
- Focus moves to the close button on open and returns to the trigger on close.
- Absent from the tree when closed, matching `ProfileMenu`, so nothing
  unreachable is rendered.

Four rules, written to stay true under any `GameConfig`:

1. The opponent's board is hidden.
2. A contested square resolves by rock, paper, scissors; matching moves clear
   both.
3. Most squares still held at the end wins.
4. Completing a line in one symbol unlocks that symbol's power-up.

Rule 4 says "a full row, column, or diagonal" rather than "three in a row", and
names no symbol-to-power-up mapping, because `streak`, `boardSize`, and
`powerupBySymbol` are all configurable. Naming specifics would make the modal
wrong for any non-default game.

A closing note states that the rules are still being tuned.

### 2. The frame

The modal is bordered in the vocabulary the board already uses: the ragged
`clip-path` edge from `.unity-cell` over a black panel, with a coloured inner
keyline.

`art/concept/SOURCES.md` records that the earlier painted frame was built and
removed for two reasons — it stacked a second splatter layer over the backdrop's
real paint, and it crowded the board. Neither applies here. A modal sits on a
dimmed overlay that covers the backdrop, and it has no neighbours to crowd. The
frame is rebuilt in CSS rather than as an image, so it carries no build weight.

### 3. The trigger

A three-card fan button, built in CSS from the existing palette, opening the
modal.

It sits beside Back on the left of the top bar. `.game-navbar` is a three-column
`auto minmax(0, 1fr) auto` grid; a fourth column would crush the status strip at
320px, so Back and help are grouped into the existing left cell instead.

Placement is expected to move. Nothing outside the navbar markup depends on it.

### 4. Battle type voice

- `Waiting for {opponentName}` becomes `Waiting for opponent`. The name adds
  nothing at the moment it is read, and a long one wrapped the line.
- `.battle-header p` (the turn line) moves to the brush face.
- `.unity-board-header h3` (the player name) moves to the brush face.

`DESIGN.md` currently reserves the block face for status copy and player names.
Both changes break that rule deliberately, so `DESIGN.md` is amended in the same
change rather than left contradicting the code.

## Testing

Vitest runs in the `node` environment against `renderToStaticMarkup`, so tests
cover rendered markup and not pointer or key handling. That matches the existing
`ProfileMenu` and `BattleUi` suites. Covered:

- The modal is absent when closed and labelled when open.
- Every rule heading renders.
- No specific streak length or symbol-to-power-up mapping appears in the copy,
  which is what keeps it honest across configs.
- The trigger carries an accessible name.

## Not in scope

- Saving the authored `?` card icon into the repo. The CSS trigger stands in for
  it, and swapping in an image later is a one-line change.
- A focus trap. Focus is moved and restored; cycling within the dialog is not
  implemented.
- Any change to gameplay, packets, or the engine.
