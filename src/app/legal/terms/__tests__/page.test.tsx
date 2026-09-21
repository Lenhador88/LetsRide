import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { OPERATOR } from '@/lib/legal/terms'

import TermsPage from '../page'

/**
 * One assertion, and it exists because the first cut of this page failed it.
 *
 * `OPERATOR` was `{ name: '[full legal name — PD-459]', … }` — a value, so it
 * rendered, so the live page told every rider *"LetsRide is run by [full legal
 * name — PD-459]"* inside the one clause that exists to say who the counterparty
 * is, having opened with *"These terms are the agreement between you and us"*.
 * Nothing caught it: `lib/legal/__tests__/terms.test.ts` pinned the two
 * placeholders to each other, which is a real interlock and says nothing about
 * what reaches a screen.
 *
 * So this asserts against the RENDERED MARKUP rather than the source — the only
 * place the distinction between "a placeholder exists" and "a placeholder is
 * published" is visible. §1 branches on a nullable constant, which is the fix;
 * this is what stops the next edit undoing it.
 *
 * **Both arms are asserted, and the file has to keep testing the one that is
 * not live.** `OPERATOR` is a real person today, and the empty arm is not dead
 * code — it is what the page falls back to if the operator is ever un-published
 * (PD-462 is the standing review of exactly that decision). A test that only
 * covered the live arm would go green through the fallback rotting.
 */
const MARKUP = renderToStaticMarkup(<TermsPage />)

describe('the terms page never publishes a placeholder', () => {
  it('shows no bracketed fill-me-in and no issue id', () => {
    // Both halves matter. A tracker id is not a rider-facing word whatever the
    // brackets do, and a bracketed blank is wrong whatever it holds.
    expect(MARKUP).not.toMatch(/\[[^\]]*\]/)
    expect(MARKUP).not.toMatch(/PD-\d+/)
  })

  it('still says who is behind the app', () => {
    // The point is not silence. "No placeholder" is otherwise satisfied by
    // deleting the clause, which is worse than the bug it fixes — art. 3:15d BW
    // asks for this paragraph specifically.
    expect(MARKUP).toContain('private individual established in the Netherlands')

    if (OPERATOR === null) {
      // The fallback has to say the disclosure is missing and how to ask for it,
      // rather than quietly omitting it.
      expect(MARKUP).toContain('not published yet')
    } else {
      // Rendered from the constant, not restated in the JSX — a second copy is
      // the failure `support-email.test.ts` exists to catch for the address, and
      // it is worse here because this copy would not move with the version.
      expect(MARKUP).toContain(OPERATOR.name)
      expect(MARKUP).toContain(OPERATOR.address)
      expect(MARKUP).not.toContain('not published yet')
    }
  })

  it('publishes a contact address, which is the half that is not owed', () => {
    expect(MARKUP).toContain('mailto:')
  })
})
