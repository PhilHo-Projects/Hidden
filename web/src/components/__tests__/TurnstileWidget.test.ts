/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  TurnstileWidget,
  type TurnstileApi,
} from '../TurnstileWidget'

describe('TurnstileWidget', () => {
  it('publishes tokens, resets after an attempt, and removes the widget on unmount', async () => {
    let callbacks: {
      callback(token: string): void
      'expired-callback'(): void
      'error-callback'(): void
    } | undefined
    const api: TurnstileApi = {
      render: vi.fn((_container, options) => {
        callbacks = options
        return 'widget-1'
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    }
    const onTokenChange = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(createElement(TurnstileWidget, {
      siteKey: 'site-key',
      resetKey: 0,
      onTokenChange,
      api,
    })))
    act(() => callbacks?.callback('one-use-token'))
    expect(onTokenChange).toHaveBeenLastCalledWith('one-use-token')

    await act(async () => root.render(createElement(TurnstileWidget, {
      siteKey: 'site-key',
      resetKey: 1,
      onTokenChange,
      api,
    })))
    expect(api.reset).toHaveBeenCalledWith('widget-1')
    expect(onTokenChange).toHaveBeenLastCalledWith(null)

    act(() => callbacks?.['expired-callback']())
    expect(onTokenChange).toHaveBeenLastCalledWith(null)
    await act(async () => root.unmount())
    expect(api.remove).toHaveBeenCalledWith('widget-1')
  })

  it('renders an accessible configuration error when no site key exists', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(createElement(TurnstileWidget, {
      siteKey: '',
      resetKey: 0,
      onTokenChange: () => undefined,
    })))

    expect(container.textContent).toContain('Bot check is not configured')
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    act(() => root.unmount())
  })
})
