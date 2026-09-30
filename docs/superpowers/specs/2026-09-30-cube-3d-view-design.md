# Cube 3D view design

Date: 2026-09-30
Status: approved in brainstorm; not started.

## Purpose

A second way to *look at* the cube prototype: a real WebGL cube, turned a
quarter at a time under a fixed camera, with the grid on its faces and the
match's mechanics played directly on it. The flat, one-face-at-a-time view from
Phase 1 stays exactly as it is. The two sit side by side under one PROTOTYPES
entry so they can be compared by playing them.

The question this answers is the same one the lab prototype (`art/lab/cube-3d/`)
started: does a physical cube make the cube mode easier to read and more fun
than the flat face plus cross map? In particular, whether arriving on a face
*rolled* — the thing a real cube does and the flat view never does — feels
natural or disorienting.

## Decisions

Three were settled in the brainstorm and are load-bearing:

1. **A view, not a variant.** The 3D cube renders the existing `prototype`
   match. `GameConfig`, the wire, the server, matchmaking, the clamp and match
   history do not change. Which view a player uses is client-only state, like
   the face camera, and never crosses the wire — so a flat player and a 3D
   player can meet online, and each sees their own view.
2. **The mini cube spins and navigates.** Drag spins it freely; tapping a face
   turns the main cube to that face. It shows only the player's own pieces.
3. **Core tile visuals, not parity.** Symbol colour with a fill tween, a press,
   desecration, shields, the loss flash, hover and turn state. The hand-cut
   edges, ink textures and the score count-up stay flat-only. The results screen
   and the reveal snapshot keep their existing flat components.

## Non-goals

- Swipe gestures. Touch works through the on-screen arrows and roll buttons.
- A 3D results screen. `CubeNet` stays.
- Sealed-face visuals for gate modes. `gateMode` defaults to `'none'` and the
  flat view does not draw sealed faces either; this is a separate piece of work
  once a gate mode ships.
- The Phase 1 debug padlock. The 3D view never locks navigation.
- Keyboard placement. Cells in the 3D view are not focusable buttons, so placing
  a piece needs a pointer. The flat view remains fully keyboard-operable.
- A mid-match view switch, except as the fallback when WebGL fails.

## Menu

`ModeSelect` becomes **MAIN | PROTOTYPES**. Choosing PROTOTYPES reveals a
second row with two options, both tagged `WIP`:

- **CUBE · FLAT** — "One face at a time, with the unfolded map."
- **CUBE · 3D** — "A real cube you turn by quarters."

Both set `config.variant = 'prototype'` through the existing
`defaultConfigForVariant`. The row sets one more piece of App state,
`cubeView: 'flat' | '3d'`, defaulting to `'flat'`. It is remembered per browser
in `localStorage` (read and written inside `try/catch`, falling back to `'flat'`)
so a returning player lands on the view they last chose. Nothing else reads it
outside the battle screen.

The hazard treatment (red control, `PROTOTYPE_WARNING`) is unchanged and
applies to the whole PROTOTYPES option. The in-match banner reads
`Prototype · 3D · under development` for the 3D view.

Choosing CUBE · 3D calls the lazy module's `import()` immediately, so the
three.js chunk downloads while the player is still in the menu rather than when
the match starts.

## Architecture

Everything 3D lives in `web/src/cube3d/`. Only two files there are imported by
the main chunk; the rest load through one `React.lazy` boundary.

| File | Chunk | What it is |
| --- | --- | --- |
| `orientation.ts` | main | Pure. The 24 orientations and quarter turns. No three.js import. |
| `useCubeOrientation.ts` | main | The 3D counterpart of `useFaceCamera`: holds an orientation, binds the keys. |
| `CubeBoard3D.tsx` | lazy | React wrapper for the main cube. |
| `MiniCube.tsx` | lazy | React wrapper for the mini cube. |
| `scene.ts` | lazy | Imperative three.js: renderer, lights, model, tiles, picking, tweens. |
| `tileVisuals.ts` | lazy | Pure. `CellState` → what a tile should look like. |

`App.tsx` owns `cubeView` and, for a prototype match, renders either today's
flat board or the lazy 3D pair. Both views read the same `match`, call the same
`onCellSelect`, and use the same `useDestructionEffects` output.

### Data flow

```
useCubeOrientation ── orientation ──► CubeBoard3D ──► scene.setOrientation (animates)
        │                                  │
        └── frontFace(orientation) ──► activeFace ──► opponent peek, reveal snapshot
                                           │
match.playerGrid (54 cells) ───────────────┴──► scene.setCells ──► tiles
scene pick (idle only) ──► onCellSelect(locationId)          (same path as BoardGrid)
MiniCube tap ──► orientation.jumpTo(face) ──► CubeBoard3D animates
```

React state holds the *target* orientation. The scene owns the animation and is
the only thing that knows whether a turn is still in flight.

## Orientation model — `orientation.ts`

An orientation is an integer 3x3 rotation matrix: nine numbers in `{-1, 0, 1}`,
whose columns are where the cube's local X, Y and Z axes point on screen
(`+X` right, `+Y` up, `+Z` toward the viewer). There are exactly 24. Integers
mean equality is exact and repeated turns cannot drift.

- `IDENTITY` is `home` in front, upright, `up` on top.
- `turn(orientation, move)` premultiplies by a screen-space quarter turn.
  `north` brings the top face to the front (about `+X` by +90°), `south` the
  bottom face, `east` the right face (about `+Y` by −90°), `west` the left face,
  `ccw`/`cw` roll about `+Z`.
- `frontFace(o)`, `topFace(o)`: the face whose rotated normal is `+Z` / `+Y`.
  Face normals and each face's own north come from the same frames
  `CUBE_ADJACENCY` assumes (home `+Z` north `+Y`; up `+Y` north `−Z`; down `−Y`
  north `+Z`; left `−X`, right `+X`, back `−Z`, all north `+Y`).
- `screenNeighbours(o)`: which face lies north, east, south and west *on
  screen*. `FaceArrows` labels its buttons from this rather than from
  `CUBE_ADJACENCY`, because on a rolled face screen-north is not the table's
  north.
- `rollDegrees(o)`: 0, 90, 180 or 270 — how far the front face's own north is
  turned from screen-up. The flat opponent peek and reveal snapshot rotate their
  grid by this, so the opponent's face is drawn the same way up as the face the
  player is looking at.
- `jumpTo(o, face)`: of the four orientations that put `face` in front, the one
  reached by the smallest rotation from `o`. An adjacent face is therefore one
  quarter turn; the opposite face is a half turn about the screen's vertical
  axis. Ties are broken by a fixed order, so it is deterministic.
- `toQuaternion(o)`: `[x, y, z, w]` for the scene.

The flat view's `CUBE_ADJACENCY` navigation is untouched. The two models agree
whenever the front face is upright, and a test asserts exactly that.

## The scene — `scene.ts`

A class, `CubeScene`, constructed on a `<canvas>` with a mode of `'board'` or
`'mini'`. It is a port of the lab's `main.js`, which already works; the fixes
found while building the lab are kept:

- **Render on demand.** A frame is requested by whatever changed. The loop keeps
  itself alive only while a tween runs, so an idle cube costs nothing.
- **Clicks only when settled.** `pick` returns nothing while a turn is in flight
  or while the board is not interactive.
- **Fresh matrices before every raycast.** three.js refreshes world matrices
  only during a render, so `pick` calls `scene.updateMatrixWorld()` and
  `camera.updateMatrixWorld()` first. Without that, a pick in the same tick a
  turn lands, or after a resize, reads last frame's cube.
- **Snap.** Each landed turn copies the exact target quaternion.
- **Dispose.** `dispose()` releases geometries, materials, textures, the
  environment map and the renderer, and removes every listener. React's
  development double-mount would otherwise leak a WebGL context each time.

Camera: perspective, 26° field of view, fixed on `+Z`, sized so the front face
covers the board slot. Lights are fixed to the view, so the face in front is
always lit the same way and faces swinging past pass through the light. Tone
mapping is `NeutralToneMapping`, which keeps the symbol colours close to their
hex values.

A turn takes 340ms with a slight overshoot. If a new target arrives mid-turn,
the scene animates from wherever it is to the new target.

Board mode sizes its canvas to the `.hidden-board-grid` element it sits in.
`CubeBoard3D` renders the same `.hidden-board` / header / `.hidden-board-grid`
structure as `BoardGrid`, so the arena's height-driven sizing and
`useBoardSideVar`'s caption and peek alignment work unchanged. `FaceArrows`
frames it exactly as it frames the flat face; two roll buttons sit at its lower
corners.

## Tiles — `tileVisuals.ts`

A pure function from `CellState` to a tile description, tested without WebGL:

| Cell | Tile |
| --- | --- |
| empty | paper (`#e8e2d4`) |
| occupied | `COLOR_BY_SYMBOL[symbol]` |
| `immune` | the symbol colour plus a shield decal floating just above the tile, textured from `assets/icons/battle/powerup-immune.png` |
| `desecrated` | paper darkened, with a hatch overlay drawn once into a `CanvasTexture` at runtime |

The scene diffs each new description against the tile's current one and tweens
the colour over 200ms with a 170ms press. A `destructionEffects` entry for a
location plays a red flash and a short sink on that tile, keyed on the effect's
`id` so the same effect never plays twice. While the board is interactive, the
tile under the pointer takes a faint yellow emissive and the cursor becomes a
pointer.

## Mini cube — `MiniCube.tsx`

The same `CubeScene` in `'mini'` mode, on its own small canvas, in the slot
`CubeMap` occupies in the flat view.

- It shows `match.playerGrid` through the same `tileVisuals`, with no tweens.
  Never the opponent's board.
- Pointer drag spins it freely (a trackball: the drag vector's perpendicular is
  the rotation axis). It starts at a three-quarter view showing `home`, `up` and
  `right`.
- A tap (pointer travel under 6px) on a face calls `jumpTo` for that face, and
  the main cube turns there.
- The face currently in front of the main cube carries a yellow outline.
- Its orientation is its own. Turning the main cube does not spin it.

## The model

`cube.glb` moves from `art/lab/cube-3d/assets/` to
`web/src/assets/models/cube.glb`, following `art/README.md`'s rule that anything
that ships moves into `web/src/assets/`. `build_cube.py` exports there directly,
and the lab page loads it from `/game/models/cube.glb`, which the lab server
already maps onto `web/src/assets/`. There is one copy.

The app imports it with `?url`, so Vite fingerprints it like every other asset.
Express's static handler serves it; the server needs no change.

The contract the scene relies on — one mesh named `body`; 54 tile nodes whose
glTF extras carry `face`, `cell` and `location`; each tile sitting on its face
in that face's frame — is asserted by a test that parses the `.glb` directly.

## Loading and bundle

- `three` becomes a runtime dependency of `web`, with `@types/three` as a dev
  dependency. The scene imports `GLTFLoader` and `RoomEnvironment` from
  `three/examples/jsm/`.
- `CubeBoard3D` and `MiniCube` are loaded with `React.lazy` behind one
  `Suspense` boundary. The fallback holds the board slot's size, so nothing
  reflows when the chunk arrives.
- Budget: the main entry chunk grows by no more than 4 KB gzipped. The lazy 3D
  chunk is expected at roughly 130–150 KB gzipped. Both numbers are measured from
  `npm run build` output and recorded in the PR.

## Failure handling

- **WebGL unavailable** (context creation throws) or **the model fails to
  load**: the board slot shows a short message and a `USE FLAT VIEW` button.
  Because the view is client-only, switching to flat mid-match is safe and loses
  nothing.
- **The lazy chunk fails to load** (network): an error boundary around the
  `Suspense` shows the same message and button.
- **Context lost** at runtime: the scene stops rendering and shows the same
  fallback. No attempt at restoring the context in this pass.

## Testing

Tests first, per `CLAUDE.md`.

- `orientation.ts`: all 24 orientations are reachable from `IDENTITY` and no
  more; each move's inverse undoes it; four of the same move is the identity;
  `frontFace` after known sequences (right then up lands on `up`, rolled, with
  `left` on top); `screenNeighbours` equals `CUBE_ADJACENCY[front]` whenever the
  front face is upright; `jumpTo` puts the requested face in front, takes one
  quarter turn to an adjacent face and a half turn to the opposite one;
  `rollDegrees` is 0 exactly when the face is upright.
- `tileVisuals.ts`: every row of the table above.
- `cube.glb` contract: 54 tiles, the right extras, `location = faceIndex * 9 +
  cell`, each tile's position on its face in that face's frame.
- `useCubeOrientation`: arrows, WASD, Q and E produce the matching turns; typing
  targets and modifier keys are ignored; coming back into a match resets to
  `IDENTITY` — mirroring `useFaceCamera`'s tests.
- `ModeSelect`: PROTOTYPES reveals the two views; each reports
  `variant: 'prototype'` and its view; MAIN hides the row.
- Everything existing stays green: `npm test`, `npm run lint`, `npm run build` in
  `web/`; `npm test`, `npm run build` in `server/`.
- WebGL cannot run in jsdom, so the scene is verified in headless Playwright
  against the built app: a practice match in the 3D view, placing on several
  faces, clicks refused mid-turn, the mini cube's tap-to-go, the reveal snapshot
  rotated to match a rolled face, and the WebGL-failure fallback forced by
  blocking the model's URL.
- The production container is built and booted on the Hetzner box, since local
  Docker is not usable.

## Open items

- Whether the rolled arrival is worth keeping, or whether turns should settle
  into each face's upright frame. This is the thing to find out by playing.
- Whether the opponent peek (open-board variants) should also become a small 3D
  cube. It stays flat, rotated to match, for now.
- Swipe and keyboard placement, once the view is worth keeping.
