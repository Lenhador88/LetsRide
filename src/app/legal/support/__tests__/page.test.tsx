import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { OPERATOR } from '@/lib/legal/terms'
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

/**
 * The rendered page with every ATTRIBUTE removed — what is left is what a rider reads.
 *
 * Stripping `href` alone is not enough: `<a href={mailto} aria-label={SUPPORT_EMAIL}>contact
 * us</a>` would satisfy both halves below while no rider could read the address, which is the
 * regression this file exists to catch.
 */
const VISIBLE = MARKUP.replace(/\s[a-zA-Z-]+="[^"]*"/g, '')

describe('the support page publishes contact information', () => {
  it('shows the address as readable text, not only inside the link', () => {
    expect(VISIBLE).toContain(SUPPORT_EMAIL)
    // The stripper works: no `mailto:` and no class survives it, so the
    // assertion above cannot be passing on the strength of an attribute it is
    // meant to exclude.
    expect(VISIBLE).not.toContain('mailto:')
    expect(VISIBLE).not.toContain('text-muted')
  })

  it('still offers the address as a link', () => {
    expect(MARKUP).toContain(`mailto:${SUPPORT_EMAIL}`)
  })

  it('points at terms §1 for the operator instead of copying it', () => {
    // The page's own header calls this non-negotiable, and until now only a
    // comment enforced it. `118` put a legal name and a HOME address in
    // `OPERATOR`; PD-462 may take both back out, and a second copy here would
    // double what that decision has to un-publish. The `null` arm has no
    // strings to look for, which is why the assertion is conditional rather
    // than absent — `OPERATOR &&` would silently stop testing anything.
    if (OPERATOR) {
      expect(MARKUP).not.toContain(OPERATOR.name)
      expect(MARKUP).not.toContain(OPERATOR.address)
    }
    expect(MARKUP).toContain('/legal/terms')
  })

  it('publishes no bracketed placeholder and no issue id', () => {
    // The trap `/legal/terms` fell into once — a placeholder that renders. This
    // page names an operator it cannot name yet, so it is the same shape.
    expect(MARKUP).not.toMatch(/\[[^\]]*\]/)
    expect(MARKUP).not.toMatch(/PD-\d+/)
  })
})
