# art/lab/

Prototypes for the look of the game — colours, motion curves, icon treatments.
Open one when you want to try something before it touches `web/src/`.

## Running it

```
cd art/lab
npm start
```

Then open <http://localhost:4180>. Set `PORT` to use a different port.

**There is nothing to install.** `serve.mjs` has no dependencies, so this folder
is not an npm workspace and `npm ci` at the repo root neither knows nor cares
about it. `npm start` here runs one file with the Node you already have.

## Why a server at all

The prototypes read the *real* game assets — `/game/` is served straight out of
`web/src/assets/`, so the board background in a prototype is the background that
ships. Change the asset, reload, and the prototype changes with it. There is no
second copy of anything to keep in step.

That is also why opening the `.html` files by double-clicking does not fully
work: a `file://` page has no usable origin, so the fonts get refused and the
asset paths point nowhere. It is one command; run the server.

## What is here

| Folder | What it is for |
| --- | --- |
| `cell-palette/` | Candidate colours for rock, paper, scissors and the desecrated tile, drawn as real board cells. Also compares flat fill against texture treatments, and simulates colour-vision deficiency. |
| `cell-fill/` | How ink arrives on a cell and how it leaves. Four of each, on shared duration sliders. |
| `nav-icons/` | Top-chrome icon treatments at their real size against the real bar. |

## Adding one

Make a folder with an `index.html` in it and add a link on the lab's own
`index.html`. Keep it to one file where you can — these are meant to be read and
thrown away, not maintained.

Conventions worth keeping:

- Reference shared assets through `/game/...`, never a copy.
- Rebuild the real thing rather than approximating it. The cell prototypes lift
  the actual `clip-path` polygons and `drop-shadow` stack out of `index.css`; a
  rounded rectangle would have answered a different question.
- When a prototype's decision lands in the app, update the prototype to match so
  it keeps showing the truth. Nothing here is generated from the app, so this is
  a manual step and the only way it stays honest.

## Rules

**Nothing in this folder ships.** The root `Dockerfile` copies only `web/`,
`server/`, and `packages/game-core/`, and `.dockerignore` excludes `art/`
outright. Vite never sees it either — it is outside `web/`.

Anything that graduates moves into `web/src/` properly: assets optimized and
named to the existing convention, colours into `web/src/game/constants.ts` or
the tokens in `web/src/index.css`, motion into `web/src/animations/`.
