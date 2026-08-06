# Concept art sources

Track where each file came from. Matters later when deciding what can ship.

| File | Origin | Notes |
| --- | --- | --- |
| `board-frame-inkgrid.png` | AI-generated (GPT image gen), 2026-08-05 | Reference for the board: brush-drawn border, blue/purple/red splatter, crown mark, torn cell edges. Not shipped — reference only. |

## What was taken from it, and what was not

The **torn cell edges** shipped and stayed — they are the `clip-path` variants on
`.unity-cell`.

The **painted frame and crown** were built, tried in-game, and removed. Two
reasons, both worth remembering before anyone rebuilds them:

1. The page backdrop already carries painted blue/purple and red splatter behind
   the board. A second splatter layer competed with real paint and muddied both.
2. At the board's actual size the frame crowded the header above and the powerup
   tray below, and read as noise rather than as framing.

A frame is still possible, but it needs to replace backdrop splatter rather than
stack on top of it.

## Shipping something from here

AI-generated images are fine as reference. Before one ships, redraw or heavily
rework it, optimize it (WebP or optimized PNG), and move it into
`web/src/assets/textures/`.
