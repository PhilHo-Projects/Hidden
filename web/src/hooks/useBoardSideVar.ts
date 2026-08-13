import { useEffect, type RefObject } from 'react'

/*
 * Publishes the played board's rendered width onto the arena as `--board-side`.
 *
 * The board is sized by the height left over on the match stage, so how wide it
 * is cannot be known until layout has run. Two siblings have to line up with its
 * edges anyway: the caption above it and the opponent peek beside it.
 *
 * There is no CSS way to say "as wide as that square". Expressing it requires the
 * arena to shrink-wrap the board, which makes the arena's width depend on a child
 * whose width comes from a percentage height -- a circular intrinsic-size
 * dependency. Blink resolves it inconsistently and WebKit resolves it to zero,
 * which rendered the board invisible on iOS. Measuring once and handing the
 * result back to CSS is the construct that behaves the same in every engine.
 */
export function useBoardSideVar(
  arenaRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const arena = arenaRef.current
    if (!active || !arena) return

    // Re-queried on every callback rather than captured once: the board remounts
    // between rounds, and a captured node would go stale and freeze the variable.
    const publish = () => {
      const grid = arena.querySelector(':scope > .hidden-board > .hidden-board-grid')
      if (!grid) return
      arena.style.setProperty(
        '--board-side',
        `${Math.round(grid.getBoundingClientRect().width)}px`,
      )
    }

    publish()

    /*
     * Two triggers, because neither covers the other. `ResizeObserver` catches
     * the cases no event reports -- the iOS toolbar retracting, the stage
     * reflowing around it -- but its callbacks are delivered as part of the
     * rendering steps, so a backgrounded or non-compositing document never gets
     * them. `resize` still fires there and covers rotation and window changes.
     * Both read layout synchronously, so neither needs to wait for a frame.
     */
    const observer = new ResizeObserver(publish)
    observer.observe(arena)
    window.addEventListener('resize', publish)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publish)
    }
  }, [arenaRef, active])
}
