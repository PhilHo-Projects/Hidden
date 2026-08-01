import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProfileMenu } from '../ProfileMenu'

const render = (overrides: Partial<Parameters<typeof ProfileMenu>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ProfileMenu, {
      username: 'Ecco',
      busy: false,
      disabled: false,
      onSignOut: () => undefined,
      ...overrides,
    }),
  )

describe('ProfileMenu', () => {
  it('shows the account name and starts closed', () => {
    const markup = render()

    expect(markup).toContain('Ecco')
    expect(markup).toContain('aria-expanded="false"')
    // The panel is absent rather than hidden, so nothing unreachable is rendered.
    expect(markup).not.toContain('profile-menu-panel')
    expect(markup).not.toContain('Sign out')
  })

  it('disables the trigger while the account slot is locked', () => {
    expect(render({ disabled: true })).toContain('disabled=""')
  })

  it('reports pending account work in place of the name', () => {
    const markup = render({ busy: true })

    expect(markup).toContain('WAIT...')
    expect(markup).toContain('disabled=""')
  })

  it('names the trigger as a disclosure rather than an ARIA menu', () => {
    const markup = render()

    // Tab-reachable buttons are what is implemented; claiming role="menu"
    // would promise arrow-key navigation that does not exist.
    expect(markup).toContain('aria-controls=')
    expect(markup).not.toContain('role="menu"')
    expect(markup).not.toContain('aria-haspopup')
  })
})
