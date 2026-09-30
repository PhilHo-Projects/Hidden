/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { IDENTITY, frontFace, rollDegrees, sameOrientation } from '../orientation'
import {
  moveForKey,
  useCubeOrientation,
  type CubeOrientationControls,
} from '../useCubeOrientation'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(active: boolean) {
  let controls: CubeOrientationControls | null = null

  function Probe({ isActive }: { isActive: boolean }) {
    controls = useCubeOrientation(isActive)
    return null
  }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = (isActive: boolean) =>
    act(() => {
      root?.render(createElement(Probe, { isActive }))
    })
  render(active)

  return { controls: () => controls as CubeOrientationControls, setActive: render }
}

function press(key: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

describe('moveForKey', () => {
  it('maps arrows, WASD and the two roll keys', () => {
    expect(moveForKey('ArrowUp')).toBe('north')
    expect(moveForKey('d')).toBe('east')
    expect(moveForKey('S')).toBe('south')
    expect(moveForKey('q')).toBe('ccw')
    expect(moveForKey('E')).toBe('cw')
    expect(moveForKey('x')).toBeNull()
  })
})

describe('useCubeOrientation', () => {
  it('starts square on home', () => {
    const { controls } = mount(true)
    expect(controls().orientation).toBe(IDENTITY)
  })

  it('turns on arrow keys and WASD', () => {
    const { controls } = mount(true)

    press('ArrowUp')
    expect(frontFace(controls().orientation)).toBe('up')
    press('s')
    expect(frontFace(controls().orientation)).toBe('home')
    press('d')
    expect(frontFace(controls().orientation)).toBe('right')
  })

  it('rolls on Q and E without changing the front face', () => {
    const { controls } = mount(true)

    press('e')
    expect(frontFace(controls().orientation)).toBe('home')
    expect(rollDegrees(controls().orientation)).toBe(90)
    press('q')
    expect(rollDegrees(controls().orientation)).toBe(0)
  })

  it('takes the key away from the page', () => {
    mount(true)
    expect(press('ArrowDown').defaultPrevented).toBe(true)
  })

  it('ignores keys typed into a field', () => {
    const { controls } = mount(true)
    const input = document.createElement('input')
    document.body.appendChild(input)

    press('q', input)
    expect(controls().orientation).toBe(IDENTITY)
  })

  it('leaves browser and OS shortcuts alone', () => {
    const { controls } = mount(true)

    press('ArrowUp', window, { ctrlKey: true })
    expect(controls().orientation).toBe(IDENTITY)
  })

  it('listens to nothing when it is not active', () => {
    const { controls } = mount(false)

    press('ArrowUp')
    expect(controls().orientation).toBe(IDENTITY)
  })

  it('jumps straight to a face', () => {
    const { controls } = mount(true)

    act(() => controls().jump('back'))
    expect(frontFace(controls().orientation)).toBe('back')
  })

  it('puts the cube back square on home when a match starts again', () => {
    const { controls, setActive } = mount(true)

    press('ArrowLeft')
    press('e')
    setActive(false)
    setActive(true)
    expect(sameOrientation(controls().orientation, IDENTITY)).toBe(true)
  })

  it('has no way to reach game state or the wire', () => {
    const { controls } = mount(true)
    expect(Object.keys(controls()).sort()).toEqual(['jump', 'orientation', 'turn'])
  })
})
