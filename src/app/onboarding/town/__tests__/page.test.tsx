import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * The town step, PD-445 — the wizard's terminal screen.
 *
 * `environment: 'node'` and a static render, per this repo's default: what is
 * pinned here is what the FIRST paint offers, and every one of these is a thing
 * a refactor reverses in silence. The place field's own keyboard, list and
 * debounce behaviour is `place-search-field.test.tsx`'s subject and none of it
 * is re-tested here.
 *
 * **What a static render can and cannot reach, stated so the gaps are not read
 * as oversights.** First paint has no pick, so it is the *no country select,
 * disabled submit* branch — which is exactly the branch that must never break,
 * because it is the one every rider sees. The two fallback branches are driven
 * by state this render cannot set (a pick whose `countryCode` is absent, and a
 * lookup failure), so they are pinned in `page.dom.test.tsx` next door, which
 * needs jsdom for a mounted effect and an event.
 *
 * `useActionState` renders fine under `renderToStaticMarkup` — it returns the
 * initial state and a no-op dispatcher on the server, which is exactly the
 * first-paint state these assertions are about.
 */
vi.mock('@/lib/actions/navigate', () => ({ useActionRedirect: () => {} }))

import OnboardingTownPage from '@/app/onboarding/town/page'

const html = () => renderToStaticMarkup(<OnboardingTownPage />)

describe('the onboarding town step', () => {
  it('refuses to submit until a town is picked', () => {
    // The one thing a refactor reverses in silence: dropping the disabled
    // binding leaves a live button whose submit is refused by `114` with a
    // message about a country the rider was never asked for. Nothing else on
    // the screen would look different.
    //
    // **`toContain('disabled')` is the wrong assertion and passes against a
    // live button** — `Button`'s own class list carries
    // `disabled:cursor-not-allowed`, `disabled:bg-disabled` and two more, so
    // the substring is present whatever the attribute does. Match the
    // ATTRIBUTE, which React renders as `disabled=""`.
    const submit = html().match(/<button[^>]*type="submit"[^>]*>/)
    expect(submit?.[0]).toBeDefined()
    expect(submit![0]).toMatch(/\sdisabled=""/)
  })

  it('asks for a town, not a country', () => {
    // The deliverable in one assertion. PD-428 built this step as a country
    // select and no query in the app is scoped to a country, so the step's own
    // copy was a promise nothing kept.
    expect(html()).toContain('Town')
    expect(html()).toContain('Search for your town or city')
  })

  it('shows NO country control on first paint', () => {
    // The country select is a fallback with two triggers — a pick that carried
    // no country, and a lookup that failed — and neither has happened here.
    // **A country select visible on first paint is the Skip decision #5
    // forbids**, arriving as a second way to answer the step rather than as a
    // button labelled Skip. That is the failure this assertion exists for, and
    // it would look completely reasonable in a diff.
    expect(html()).not.toContain('Country')
  })

  it('carries exactly one field named country — here, none', () => {
    // `CountrySelect` renders its own hidden input from `name`, and the step
    // renders one of its own for a pick that carried a country. Two live
    // fields called `country` would make `formData.get('country')` return
    // whichever came first, silently shadowing the rider's answer with nothing
    // wrong on screen. They are mutually exclusive by construction; this pins
    // the count on the branch a static render can reach.
    const countryFields = html().match(/name="country"/g) ?? []
    expect(countryFields).toHaveLength(0)
  })

  it('offers no way to skip', () => {
    // Decision #5: onboarding is required and not skippable, and no step
    // carries a skip affordance. The DRAWN frame has a `Skip` button, so this
    // is the assertion standing between the design and the decision — a later
    // session building "to the frame" would add it back.
    //
    // PD-445 makes this MORE load-bearing rather than less: the country select
    // is now reachable, so the rule it protects is no longer "there is no
    // second control" but "the second control appears on a failure and never
    // on the rider declining to answer".
    expect(html()).not.toMatch(/skip/i)
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
