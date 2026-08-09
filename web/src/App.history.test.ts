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

describe('App match history navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('returns to the exact signed-in screen that opened history', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/auth/session') {
        return jsonResponse({
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            username: 'HistoryPlayer',
            role: 'player',
          },
        })
      }
      if (url === '/api/history') {
        return jsonResponse({
          stats: { played: 0, wins: 0, losses: 0, ties: 0 },
          matches: [],
          nextCursor: null,
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const { default: App } = await import('./App')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    function buttonByText(text: string) {
      const button = [...container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes(text),
      )
      if (!button) throw new Error(`Button not found: ${text}`)
      return button
    }

    async function click(button: HTMLButtonElement) {
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }

    try {
      await act(async () => root.render(createElement(App)))
      await vi.waitFor(() => {
        expect(container.textContent).toContain('CONTINUE AS HistoryPlayer')
      })

      await click(buttonByText('CONTINUE AS HistoryPlayer'))
      await click(buttonByText('ONLINE'))
      expect(container.textContent).toContain('QUICK MATCH')

      const profileTrigger = container.querySelector<HTMLButtonElement>(
        '.profile-menu-trigger',
      )
      if (!profileTrigger) throw new Error('Profile trigger not found')
      await click(profileTrigger)
      const openHistory = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Open match history"]',
      )
      if (!openHistory) throw new Error('Match history menu item not found')
      await click(openHistory)
      await vi.waitFor(() => {
        expect(container.textContent).toContain('No completed online matches yet')
      })

      const goBack = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Go back"]',
      )
      if (!goBack) throw new Error('Global back button not found')
      await click(goBack)

      expect(container.textContent).toContain('QUICK MATCH')
      expect(container.textContent).toContain('CREATE GAME')
      expect(container.textContent).not.toContain('Match History')
      expect(fetcher).toHaveBeenCalledWith('/api/history', {
        headers: { Accept: 'application/json' },
      })
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
