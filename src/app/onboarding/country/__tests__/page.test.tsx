import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * The country step, PD-428 — the wizard's terminal screen.
 *
 * `environment: 'node'` and a static render, per this repo's default: what is
 * pinned here is what the FIRST paint offers, and every one of these is a thing
 * a refactor reverses in silence. The picker's own keyboard and portal
 * behaviour is `CountrySelect.test.tsx`'s subject and needs jsdom; none of it
 * is re-tested here.
 *
 * `useActionState` renders fine under `renderToStaticMarkup` — it returns the
 * initial state and a no-op dispatcher on the server, which is exactly the
 * first-paint state these assertions are about.
 */
vi.mock('@/lib/actions/navigate', () => ({ useActionRedirect: () => {} }))

import OnboardingCountryPage from '@/app/onboarding/country/page'

const html = () => renderToStaticMarkup(<OnboardingCountryPage />)

describe('the onboarding country step', () => {
  it('refuses to submit until a country is chosen', () => {
    // The one thing a refactor reverses in silence: dropping `disabled={!country}`
    // leaves a live button whose submit is refused by `114` with a message
    // about a country the rider thinks they have given. Nothing else on the
    // screen would look different.
    // Order-independent on purpose: React emits `disabled` before `type` here,
    // and an assertion that pins their order fails on a re-render that changes
    // nothing a rider can see.
    //
    // **`toContain('disabled')` is the wrong assertion and passes against a
    // live button** — `Button`'s own class list carries
    // `disabled:cursor-not-allowed`, `disabled:bg-disabled` and two more, so
    // the substring is present whatever the attribute does. Measured: with
    // `disabled={!country}` deleted, that version reported 5/5 green. Match the
    // ATTRIBUTE, which React renders as `disabled=""`.
    const submit = html().match(/<button[^>]*type="submit"[^>]*>/)
    expect(submit?.[0]).toBeDefined()
    expect(submit![0]).toMatch(/\sdisabled=""/)
  })

  it('offers no way to skip', () => {
    // Decision #5: onboarding is required and not skippable, and no step
    // carries a skip affordance. The DRAWN frame has a `Skip` button, so this
    // is the assertion standing between the design and the decision — a later
    // session building "to the frame" would add it back.
    expect(html()).not.toMatch(/skip/i)
  })

  it('carries the code to the action under the name the action parses', () => {
    // `CountrySelect` renders its own hidden input from `name`. Drop that prop
    // and the form posts nothing: `setHomeCountry` reads `formData.get('country')`,
    // gets null, and every submit is refused with a validation message while
    // the rider can plainly see a country selected.
    expect(html()).toMatch(/<input[^>]*type="hidden"[^>]*name="country"/)
  })

  it('offers the way back to the step before it', () => {
    // The guard permits standing on the username step once it is done, which is
    // what makes this live rather than a bounce. A Back link that redirects
    // straight back is worse than none, because it looks like it works.
    expect(html()).toContain('href="/onboarding/username"')
  })

  it('shows the rider where they are in the wizard', () => {
    // Two steps, and this is the second. `Pagination` renders a progressbar
    // labelled with the position; a wrong `current` is invisible in markup
    // except through this label.
    expect(html()).toContain('aria-label="Step 2 of 2"')
  })
})
