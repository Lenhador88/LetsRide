import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

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
 * published" is visible. The constant is `null` now and §1 branches, which is
 * the fix; this is what stops the next edit undoing it.
 */
const MARKUP = renderToStaticMarkup(<TermsPage />)

describe('the terms page never publishes a placeholder', () => {
  it('shows no bracketed fill-me-in and no issue id', () => {
    // Both halves matter. A tracker id is not a rider-facing word whatever the
    // brackets do, and a bracketed blank is wrong whatever it holds.
    expect(MARKUP).not.toMatch(/\[[^\]]*\]/)
    expect(MARKUP).not.toMatch(/PD-\d+/)
  })

  it('still says who is behind the app, and that the name is owed', () => {
    // The point is not silence. With no operator to name, §1 has to tell the
    // rider that the disclosure art. 3:15d BW entitles them to is missing and
    // how to ask for it — otherwise "no placeholder" is satisfied by deleting
    // the clause, which is worse than the bug.
    expect(MARKUP).toContain('private individual established in the Netherlands')
    expect(MARKUP).toContain('not published yet')
  })

  it('publishes a contact address, which is the half that is not owed', () => {
    expect(MARKUP).toContain('mailto:')
  })
})
