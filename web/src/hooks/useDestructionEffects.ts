import { useCallback, useEffect, useRef, useState } from 'react'
import type { CellDestructionEffect } from '../components/BoardGrid'

export type DestructionEffectMap = Partial<Record<number, CellDestructionEffect>>

export interface DestructionEffects {
  playerDestructionEffects: DestructionEffectMap
  queueDestructionEffect: (index: number) => void
  clearDestructionEffects: () => void
}

export function useDestructionEffects(): DestructionEffects {
  const [playerDestructionEffects, setPlayerDestructionEffects] =
    useState<DestructionEffectMap>({})
  const destructionSequenceRef = useRef(0)
  const destructionTimeoutsRef = useRef<number[]>([])

  useEffect(
    () => () => {
      for (const timeoutId of destructionTimeoutsRef.current) {
        window.clearTimeout(timeoutId)
      }
    },
    [],
  )

  /*
   * Only the local player's own losses animate. Showing destruction on the
   * opponent board would turn placement into a free information probe.
   */
  const queueDestructionEffect = useCallback((index: number) => {
    const id = ++destructionSequenceRef.current

    setPlayerDestructionEffects((current) => ({
      ...current,
      [index]: { id, tone: 'loss' },
    }))
    const timeoutId = window.setTimeout(() => {
      setPlayerDestructionEffects((current) => {
        if (current[index]?.id !== id) return current
        const next = { ...current }
        delete next[index]
        return next
      })
    }, 620)
    destructionTimeoutsRef.current.push(timeoutId)
  }, [])

  const clearDestructionEffects = useCallback(() => {
    setPlayerDestructionEffects({})
  }, [])

  return {
    playerDestructionEffects,
    queueDestructionEffect,
    clearDestructionEffects,
  }
}
