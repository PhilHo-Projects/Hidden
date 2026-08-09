import { useEffect, useState } from 'react'
import { COLOR_BY_SYMBOL } from '../game/constants'
import type { ClassicSymbol } from '@hidden/game-core'

/*
 * A cell's colour is a layer over its face rather than the face itself. That is
 * what makes it able to arrive and leave: a background cannot grow from the
 * middle, and a drain has to keep painting a colour the cell no longer has.
 *
 * This module owns which cells are mid-transition. `cell-ink.css` owns what the
 * transition looks like, and BoardGrid only mounts what it is told to.
 */

/**
 * The face a cell wears with no ink on it. It stays under the ink layer rather
 * than being replaced by it, so the fill grows out of an empty square and the
 * drain leaves one behind.
 */
export const EMPTY_TONE = '#f5f5f5'

export function inkTone(symbol: ClassicSymbol | null, hidden: boolean) {
  if (hidden) return 'linear-gradient(145deg, #383838, #080808)'

  return symbol ? COLOR_BY_SYMBOL[symbol] : '#F2EEE7'
}

/*
 * Mirrors of the shared cell-motion tokens in `index.css`, plus a frame of slack
 * so a layer is never unmounted out from under its own last frame. They are held
 * here rather than read back off the element because the class has to come off
 * on a schedule the animation cannot report for a layer that stays.
 */
const CELL_MOTION_IN_MS = 270

/** Also how long BoardGrid holds a released desecration overlay: the brown and
 * the ink leave on the same motion, so they leave on the same clock. */
export const CELL_MOTION_OUT_MS = 520

/** Separates tones in a board's ink key. No tone contains it. */
export const TONE_SEPARATOR = '|'

export interface CellInkDiff {
  /** Cells that gained ink and should grow it from the middle. */
  filled: number[]
  /**
   * Cells that lost ink, each with the tone it lost, which is the tone the
   * drain has to keep painting after the cell is already empty.
   */
  drained: [number, string][]
}

/**
 * The transition between two boards' worth of ink, read off their tone keys.
 *
 * A cell that swapped one tone for another is neither: the layer is already
 * down and only its colour changed. Indices past the end of either key are
 * ignored, so a change of board size — a different board, not a move on this
 * one — reports nothing rather than filling a whole grid at once.
 */
export function diffCellInk(previousKey: string, nextKey: string): CellInkDiff {
  const before = previousKey.split(TONE_SEPARATOR)
  const after = nextKey.split(TONE_SEPARATOR)
  const filled: number[] = []
  const drained: [number, string][] = []

  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    const was = before[index]
    const now = after[index]
    if (now && !was) filled.push(index)
    else if (!now && was) drained.push([index, was])
  }

  return { filled, drained }
}

/**
 * The cells whose ink is arriving or leaving, each held for its animation.
 *
 * Both sides have to outlive the state that created them. A fill has to know the
 * cell *just* became occupied, because a board that mounts with ink already down
 * — a results board, the revealed opponent peek — must not replay every cell at
 * once. A drain has to outlive the cell entirely: it paints a tone the cell no
 * longer has. Keyed on a string of the tones rather than the cell array, which
 * is a new object every render.
 */
export function useCellInk(toneKey: string) {
  const [previousKey, setPreviousKey] = useState(toneKey)
  const [filling, setFilling] = useState<ReadonlySet<number>>(new Set())
  const [draining, setDraining] = useState<ReadonlyMap<number, string>>(new Map())

  // Adjusted during render for the same reason `useDesecrationRelease` does it:
  // this is derived from a prop change, and an effect would commit one frame of
  // the wrong thing before correcting it.
  if (previousKey !== toneKey) {
    const { filled, drained } = diffCellInk(previousKey, toneKey)
    setPreviousKey(toneKey)
    if (filled.length > 0) setFilling((current) => new Set([...current, ...filled]))
    if (drained.length > 0) setDraining((current) => new Map([...current, ...drained]))
  }

  /*
   * One timer per side for the whole board. A second arrival mid-flight restarts
   * it and clears the earlier ones with the later, which costs nothing: both
   * animations hold their end state, so the extra time is spent on a frame
   * identical to the one already on screen.
   */
  useEffect(() => {
    if (filling.size === 0) return
    const timeoutId = window.setTimeout(() => setFilling(new Set()), CELL_MOTION_IN_MS)
    return () => window.clearTimeout(timeoutId)
  }, [filling])

  useEffect(() => {
    if (draining.size === 0) return
    const timeoutId = window.setTimeout(() => setDraining(new Map()), CELL_MOTION_OUT_MS)
    return () => window.clearTimeout(timeoutId)
  }, [draining])

  return { filling, draining }
}
