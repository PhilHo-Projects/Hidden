import { lazy } from 'react'

/*
 * The only door to three.js. Everything behind these imports lands in its own
 * chunk, so a MAIN player never downloads it.
 */
const loadBoard = () => import('./BoardCanvas')
const loadMini = () => import('./MiniCanvas')

export const LazyBoardCanvas = lazy(() =>
  loadBoard().then((module) => ({ default: module.BoardCanvas })),
)

export const LazyMiniCanvas = lazy(() =>
  loadMini().then((module) => ({ default: module.MiniCanvas })),
)

/**
 * Starts the 3D chunk downloading while the player is still in the menu. A
 * failure here is ignored: the lazy components retry their own import and show
 * the fallback if that fails too.
 */
export function preloadCube3D(): void {
  void loadBoard().catch(() => undefined)
  void loadMini().catch(() => undefined)
}
