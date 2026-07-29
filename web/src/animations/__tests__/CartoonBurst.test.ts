import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CartoonBurst } from '../CartoonBurst'

describe('CartoonBurst', () => {
  it('renders a decorative layered burst with positionable sparks', () => {
    const markup = renderToStaticMarkup(
      createElement(CartoonBurst, { className: 'landing-burst-demo' }),
    )

    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('cartoon-burst landing-burst-demo')
    expect(markup).toContain('cartoon-burst__flash')
    expect(markup).toContain('cartoon-burst__ring')
    expect(markup.match(/cartoon-burst__spark/g)).toHaveLength(8)
  })
})
