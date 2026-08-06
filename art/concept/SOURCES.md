# Concept art sources

Track where each file came from. Matters later when deciding what can ship.

| File | Origin | Notes |
| --- | --- | --- |
| `board-frame-inkgrid.png` | AI-generated (GPT image gen), 2026-08-05 | Reference for the board: brush-drawn border, blue/purple/red splatter, crown mark, torn cell edges. Not shipped — reference only. |
| `InstructionIcon.png` | Authored by Phil, 2026-08-06 | Master for the how-to-play trigger: three fanned question cards in red, green, and blue on transparency. **This is the master, not the shipped file** — see below. |

## The how-to-play trigger

`InstructionIcon.png` is 1536x1024 and 2.5 MB, with the artwork occupying a
1017x678 box inside a mostly empty canvas. It is kept here at full size because
this folder is where masters live and nothing here reaches the container.

What ships is `web/src/assets/icons/how-to-play.webp`: cropped to the artwork,
scaled to 240x160, and encoded as WebP with alpha. 18.8 KB, about 0.7% of the
master, and still more than double the pixels the trigger needs at 3x.

Regenerate it with ffmpeg after editing the master:

```
ffmpeg -i art/concept/InstructionIcon.png \
  -vf "crop=1017:678:270:114,premultiply=inplace=1,scale=240:160:flags=lanczos,unpremultiply=inplace=1" \
  -c:v libwebp -quality 88 -compression_level 6 \
  web/src/assets/icons/how-to-play.webp
```

The `premultiply`/`unpremultiply` pair matters. The master's fully transparent
pixels are not black — they carry leftover grey RGB — and scaling straight alpha
blends that grey into the soft edges as a halo. Premultiplying before the scale
is what keeps the cut-out clean against the near-black top bar. Re-derive the
crop box if the artwork moves on the canvas.

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
