/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

class PendingWebSocket {
  static readonly OPEN = 1
  binaryType = ''
  readyState = 0
  close() {}
  send() {}
}

describe('App admin workspace locking', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('closes an open admin workspace when the game enters a locked match phase', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() { this.setAttribute('open', '') },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value() { this.removeAttribute('open') },
    })
    vi.stubGlobal('WebSocket', PendingWebSocket)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/auth/session') {
        return jsonResponse({
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            username: 'PhilAdmin',
            role: 'admin',
          },
        })
      }
      if (url === '/api/admin/stats') {
        return jsonResponse({
          capturedAt: '2030-01-01T00:00:00.000Z',
          runtime: {
            connections: 0,
            onlinePlayers: 0,
            namedPlayers: 0,
            authenticatedPlayers: 0,
            guestPlayers: 0,
            queuedPlayers: 0,
            pendingLobbies: 0,
            activeMatches: 0,
          },
          storage: { accounts: 1, activeSessions: 1, matches: 0 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
    const { default: App } = await import('./App')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    function buttonByText(text: string) {
      const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent?.includes(text))
      if (!button) throw new Error(`Button not found: ${text}`)
      return button
    }

    async function click(button: HTMLButtonElement) {
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    }

    try {
      await act(async () => root.render(createElement(App)))
      await vi.waitFor(() => expect(container.textContent).toContain('CONTINUE AS PhilAdmin'))
      await click(buttonByText('CONTINUE AS PhilAdmin'))
      await click(buttonByText('ONLINE'))
      await click(container.querySelector<HTMLButtonElement>('.profile-menu-trigger')!)
      await click(container.querySelector<HTMLButtonElement>('button[aria-label="Open admin workspace"]')!)
      expect(container.querySelector('dialog')?.open).toBe(true)
      await click(buttonByText('Matches'))
      expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Matches')

      await click(buttonByText('QUICK MATCH'))
      expect(container.querySelector('dialog')?.open).toBe(false)

      await click(buttonByText('BACK'))
      await click(container.querySelector<HTMLButtonElement>('.profile-menu-trigger')!)
      await click(container.querySelector<HTMLButtonElement>('button[aria-label="Open admin workspace"]')!)
      expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Stats')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
