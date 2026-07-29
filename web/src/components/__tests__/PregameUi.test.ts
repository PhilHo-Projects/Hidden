import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ActionChoice,
  GameMasthead,
  GuestIdentity,
  StatusStrip,
} from '../PregameUi'

describe('pre-game UI', () => {
  it('renders a compact masthead without changing the game title', () => {
    const markup = renderToStaticMarkup(createElement(GameMasthead, { compact: true }))

    expect(markup).toContain('game-title-compact')
    expect(markup).toContain('>HIDDEN</h1>')
  })

  it('makes unavailable choices visibly and semantically disabled', () => {
    const markup = renderToStaticMarkup(
      createElement(ActionChoice, {
        label: 'CREATE GAME',
        description: 'Make a private match.',
        badge: 'Coming soon',
        disabled: true,
      }),
    )

    expect(markup).toContain('disabled=""')
    expect(markup).toContain('CREATE GAME')
    expect(markup).toContain('Make a private match.')
    expect(markup).toContain('Coming soon')
  })

  it('announces working status without treating it as an error', () => {
    const markup = renderToStaticMarkup(
      createElement(StatusStrip, {
        status: {
          tone: 'working',
          label: 'SEARCHING',
          detail: 'Looking for an opponent · 00:14',
        },
      }),
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('Looking for an opponent · 00:14')
  })

  it('marks status rendered in the persistent top chrome', () => {
    const markup = renderToStaticMarkup(
      createElement(StatusStrip, {
        chrome: true,
        status: {
          tone: 'success',
          label: 'OFFLINE',
          detail: 'Practice bot ready.',
        },
      }),
    )

    expect(markup).toContain('status-strip-chrome')
    expect(markup).toContain('role="status"')
  })

  it('uses an alert role for connection failures and shows guest identity', () => {
    const errorMarkup = renderToStaticMarkup(
      createElement(StatusStrip, {
        status: {
          tone: 'error',
          label: 'CONNECTION ERROR',
          detail: 'Unable to reach the Hidden server.',
        },
      }),
    )
    const identityMarkup = renderToStaticMarkup(
      createElement(GuestIdentity, { name: 'Guest#4821' }),
    )

    expect(errorMarkup).toContain('role="alert"')
    expect(identityMarkup).toContain('Playing as')
    expect(identityMarkup).toContain('Guest#4821')
  })
})
