import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SUPPORT_EMAIL } from '@/lib/support'

import SupportPage from '../page'

/**
 * This page exists to satisfy App Store Connect's **Support URL**, whose stated
 * requirement is that it *"must lead to actual contact information"*. The
 * failure it guards is not a missing page — it is a page that still links a
 * `mailto:` while the address itself has become the words "contact us", which
 * reads fine, passes every other gate, and is no longer contact information a
 * reviewer or a locked-out rider can read.
 *
 * So both halves are asserted separately, and the stripper that separates them
 * is verified both ways: without the second `expect` in the first test, an
 * `href` regex that stopped matching would let the anchor satisfy the
 * visible-text half for ever.
 */
const MARKUP = renderToStaticMarkup(<SupportPage />)

/** The rendered page with every `href` removed — what is left is what a rider reads. */
const VISIBLE = MARKUP.replace(/href="[^"]*"/g, '')

describe('the support page publishes contact information', () => {
  it('shows the address as readable text, not only inside the link', () => {
    expect(VISIBLE).toContain(SUPPORT_EMAIL)
    // The stripper works: no `mailto:` survives it, so the assertion above
    // cannot be passing on the strength of the `href` it is meant to exclude.
    expect(VISIBLE).not.toContain('mailto:')
  })

  it('still offers the address as a link', () => {
    expect(MARKUP).toContain(`mailto:${SUPPORT_EMAIL}`)
  })

  it('publishes no bracketed placeholder and no issue id', () => {
    // The trap `/legal/terms` fell into once — a placeholder that renders. This
    // page names an operator it cannot name yet, so it is the same shape.
    expect(MARKUP).not.toMatch(/\[[^\]]*\]/)
    expect(MARKUP).not.toMatch(/PD-\d+/)
  })
})
