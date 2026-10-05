/*
 * Which way a player looks at the cube prototype. A view, not a rule: both views
 * play the same `prototype` match, so this is never in `GameConfig` and never
 * crosses the wire, and a flat player can meet a 3D player online.
 *
 * Remembered per browser so a returning player lands on the view they last
 * chose. Storage can be missing, blocked, or hold anything; all of those read
 * as 'flat'.
 */
export type CubeView = 'flat' | '3d'

export const CUBE_VIEWS: readonly CubeView[] = ['flat', '3d']

const STORAGE_KEY = 'hidden.cubeView'

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem'>

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function readCubeView(storage: Reader | undefined = browserStorage()): CubeView {
  try {
    return storage?.getItem(STORAGE_KEY) === '3d' ? '3d' : 'flat'
  } catch {
    return 'flat'
  }
}

export function writeCubeView(view: CubeView, storage: Writer | undefined = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, view)
  } catch {
    // A preference, not state. Losing it costs one click next time.
  }
}
