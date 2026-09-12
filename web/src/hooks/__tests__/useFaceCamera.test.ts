/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useFaceCamera, type FaceCameraControls } from '../useFaceCamera'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(active: boolean) {
  let controls: FaceCameraControls | null = null

  function Probe({ isActive }: { isActive: boolean }) {
    controls = useFaceCamera(isActive)
    return null
  }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(createElement(Probe, { isActive: active }))
  })

  return () => controls as FaceCameraControls
}

function press(key: string, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

describe('useFaceCamera', () => {
  it('starts on home', () => {
    const controls = mount(true)

    expect(controls().camera).toEqual({ face: 'home', locked: false })
  })

  it('moves on arrow keys', () => {
    const controls = mount(true)

    press('ArrowUp')
    expect(controls().camera.face).toBe('up')
    press('ArrowRight')
    expect(controls().camera.face).toBe('right')
  })

  it('moves on WASD', () => {
    const controls = mount(true)

    press('a')
    expect(controls().camera.face).toBe('left')
  })

  it('takes the arrow key away from the page', () => {
    mount(true)
    const event = new window.KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores keys typed into a field', () => {
    // The battle screen has no text input today, but the listener is on
    // `window` and the account and lobby screens do. A hook that ate "a" would
    // be a bug nobody would connect to a cube.
    const controls = mount(true)
    const input = document.createElement('input')
    document.body.appendChild(input)

    press('a', input)
    expect(controls().camera.face).toBe('home')
  })

  it('leaves browser and OS shortcuts alone', () => {
    const controls = mount(true)

    act(() => {
      window.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, bubbles: true }),
      )
    })

    expect(controls().camera.face).toBe('home')
  })

  it('refuses keys while locked', () => {
    const controls = mount(true)

    act(() => controls().toggleLock())
    press('ArrowUp')

    expect(controls().camera).toEqual({ face: 'home', locked: true })
  })

  it('listens to nothing when it is not active', () => {
    const controls = mount(false)

    press('ArrowUp')
    expect(controls().camera.face).toBe('home')
  })

  it('has no way to reach game state or the wire', () => {
    // The spec asks that the padlock be provable to change presentation only.
    // The proof is structural rather than behavioural: the hook takes one
    // boolean and returns four things, none of which is a command, a packet, a
    // seat, or a board. There is no channel for it to affect a match through.
    const controls = mount(true)

    expect(Object.keys(controls()).sort()).toEqual(['camera', 'jump', 'move', 'toggleLock'])
    expect(Object.keys(controls().camera).sort()).toEqual(['face', 'locked'])
  })
})
