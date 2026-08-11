/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useDestructionEffects,
  type DestructionEffects,
} from '../useDestructionEffects'

describe('useDestructionEffects', () => {
  let container: HTMLDivElement
  let root: Root
  let current: DestructionEffects

  function Harness() {
    current = useDestructionEffects()
    return null
  }

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('does not let an older timeout erase a newer effect on the same cell', async () => {
    await act(async () => current.queueDestructionEffect(4))
    const firstId = current.playerDestructionEffects[4]?.id

    await act(async () => vi.advanceTimersByTimeAsync(100))
    await act(async () => current.queueDestructionEffect(4))
    const secondEffect = current.playerDestructionEffects[4]

    expect(secondEffect).toEqual({ id: (firstId ?? 0) + 1, tone: 'loss' })

    await act(async () => vi.advanceTimersByTimeAsync(520))
    expect(current.playerDestructionEffects[4]).toEqual(secondEffect)

    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(current.playerDestructionEffects[4]).toBeUndefined()
  })

  it('clears all visible effects on demand', async () => {
    await act(async () => current.queueDestructionEffect(2))
    expect(current.playerDestructionEffects[2]).toBeDefined()

    await act(async () => current.clearDestructionEffects())

    expect(current.playerDestructionEffects).toEqual({})
  })
})
