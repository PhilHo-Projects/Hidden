import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { validateAccountSubmission } from '../../auth/accountValidation'
import { AccountForm } from '../AccountForm'

describe('AccountForm', () => {
  it('renders accessible registration fields and explains the no-recovery tradeoff', () => {
    const markup = renderToStaticMarkup(
      createElement(AccountForm, {
        mode: 'register',
        busy: false,
        error: null,
        onModeChange: () => undefined,
        onSubmit: async () => undefined,
      }),
    )

    expect(markup).toContain('Create account')
    expect(markup).toContain('name="username"')
    expect(markup).toContain('autoComplete="username"')
    expect(markup).toContain('autoComplete="new-password"')
    expect(markup).toContain('Confirm password')
    expect(markup).toContain('No password recovery')
    expect(markup).toContain('Log in')
  })

  it('renders login without a confirmation field and exposes pending state', () => {
    const markup = renderToStaticMarkup(
      createElement(AccountForm, {
        mode: 'login',
        busy: true,
        error: 'Username or password is incorrect.',
        onModeChange: () => undefined,
        onSubmit: async () => undefined,
      }),
    )

    expect(markup).toContain('Log in')
    expect(markup).toContain('autoComplete="current-password"')
    expect(markup).not.toContain('Confirm password')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
  })

  it('blocks a mismatched registration password before an API request', () => {
    expect(
      validateAccountSubmission(
        'register',
        'correct horse battery staple',
        'correct horse battery',
      ),
    ).toBe('Passwords do not match.')
    expect(
      validateAccountSubmission(
        'login',
        'correct horse battery staple',
        '',
      ),
    ).toBeNull()
  })
})
