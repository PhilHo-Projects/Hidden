import { describe, expect, it } from 'vitest'
import { RuntimeLifecycle } from './runtimeLifecycle'

describe('RuntimeLifecycle', () => {
  it('prevents listening after shutdown starts during asynchronous setup', async () => {
    let releaseSetup: (() => void) | undefined
    const setupBlocked = new Promise<void>((resolve) => {
      releaseSetup = resolve
    })
    let listened = false
    let cleanedUp = false
    const lifecycle = new RuntimeLifecycle(
      async (isStopping) => {
        await setupBlocked
        if (isStopping()) return
        listened = true
      },
      async () => {
        cleanedUp = true
      },
    )

    const starting = lifecycle.start()
    const stopping = lifecycle.stop()
    releaseSetup?.()

    await Promise.all([starting, stopping])
    expect(listened).toBe(false)
    expect(cleanedUp).toBe(true)
  })

  it('runs shutdown once when stop is requested repeatedly', async () => {
    let stopCount = 0
    const lifecycle = new RuntimeLifecycle(
      async () => undefined,
      async () => {
        stopCount += 1
      },
    )

    await lifecycle.start()
    await Promise.all([lifecycle.stop(), lifecycle.stop()])

    expect(stopCount).toBe(1)
  })
})
