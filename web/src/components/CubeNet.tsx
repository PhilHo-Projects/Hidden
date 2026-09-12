import '../prototype-mode.css'
import { firstLocationOfFace } from '@hidden/game-core'
import { BoardGrid, type CellDestructionEffect } from './BoardGrid'
import { CROSS_LAYOUT, FACE_LABELS, faceCells } from '../game/faceNavigation'
import type { GridState } from '../game/types'

interface CubeNetProps {
  subtitle: string
  grid: GridState
  scoreCountLabels?: Partial<Record<number, number>>
  destructionEffects?: Partial<Record<number, CellDestructionEffect>>
}

/**
 * All six faces at once, in the same cross the map uses.
 *
 * The result screen is a score audit, so one face at a time would be the wrong
 * shape — a player counting their cells should not have to navigate. The cross
 * rather than a 3x2 block because the in-match map already taught this
 * arrangement, and a second one would be a second thing to learn for no gain.
 */
export function CubeNet({
  subtitle,
  grid,
  scoreCountLabels = {},
  destructionEffects = {},
}: CubeNetProps) {
  return (
    <section className="cube-net" aria-label={`${subtitle}: cube`}>
      {CROSS_LAYOUT.map((face, index) =>
        face === null ? (
          <span key={index} className="cube-net-blank" aria-hidden="true" />
        ) : (
          <BoardGrid
            key={index}
            title=""
            subtitle={FACE_LABELS[face]}
            grid={faceCells(grid, face)}
            columns={3}
            indexOffset={firstLocationOfFace(face)}
            compact
            showDesecration={false}
            scoreCountLabels={scoreCountLabels}
            destructionEffects={destructionEffects}
          />
        ),
      )}
    </section>
  )
}
