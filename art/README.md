# art/

Scratch space for reference art, concepts, and things being tried out. Think of
it as the folder outside `Assets/` in a Unity project — it lives in git so ideas
are not lost, but nothing here is production.

**Nothing in this folder ships.** The root `Dockerfile` only copies `web/`,
`server/`, and `packages/game-core/` into the build stage, so files here cannot
reach the container even by accident. Vite never sees them either.

## Layout

- `concept/` — reference images, mood boards, generated concepts, sketches.

## Rules

- Anything that ships moves to `web/src/assets/` first, optimized and named to
  match the existing convention (`textures/`, `icons/`, `backgrounds/`).
- Note the provenance of anything generated or downloaded in
  `concept/SOURCES.md` so it is clear later what is original work, what is
  AI-generated, and what came from somewhere with a licence attached.
