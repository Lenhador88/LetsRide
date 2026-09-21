import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * `Create club`, after PD-446 made the location required.
 *
 * `environment: 'node'` with a static render, per this repo's default: what is
 * pinned here is what the FIRST paint offers. The seeded search term is a
 * first-FOCUS behaviour and so is deliberately not testable at this level — it
 * has no jsdom test either, because it needs a focus event on a mounted field
 * plus a settled `useQuery`, and `place-search-field.test.tsx` is where the
 * primitive's own behaviour lives.
 *
 * **The one thing this file exists for is the submit button**, and it is an
 * assertion that a later session will read as a bug and try to "fix": the
 * location is required, and the button is still not gated on it. See the
 * comment beside the button itself — six controls, a disabled submit reads as
 * the resting state of an untouched form, and it was tried on this form and
 * reverted. PD-445's onboarding step gates its submit and is also right, for
 * the opposite reason: one question, nothing after it in the tab order.
 */
vi.mock('@/lib/actions/navigate', () => ({ useActionRedirect: () => {} }))
// The seed's read. `undefined` is the unsettled state and a supported one — the
// form renders identically without a town, which is what the last case pins.
vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query')>()),
  useQuery: () => ({ data: undefined }),
}))

import { CreateClubForm } from '@/components/clubs/CreateClubForm'

const html = () => renderToStaticMarkup(<CreateClubForm />)

describe('the create-club form', () => {
  it('does NOT disable the submit for a missing location', () => {
    // The regression this refuses: "the location is required, so gate the
    // button" — which greys out the one control at the end of a six-field form
    // that a rider has not reached yet, and drops it from the tab order. The
    // action refuses the submit and the form moves focus to the field instead.
    //
    // **`not.toContain('disabled')` would be the wrong assertion and would
    // fail against correct markup** — `Button`'s class list carries
    // `disabled:cursor-not-allowed` and three more, so the substring is there
    // whatever the attribute does. Match the ATTRIBUTE, which React renders as
    // `disabled=""`.
    const submit = html().match(/<button[^>]*type="submit"[^>]*>/)
    expect(submit?.[0]).toBeDefined()
    expect(submit![0]).not.toMatch(/\sdisabled=""/)
  })

  it('stops calling the location optional', () => {
    // The label carried `(optional)` and the copy above it said so twice. A
    // required field still labelled optional is worse than either, because the
    // refusal then contradicts the screen.
    expect(html()).not.toMatch(/optional/i)
  })

  it('still says the location is the club’s and not the rider’s', () => {
    // The helper text predates this change and is still correct — the seeded
    // term is the rider's town, so the sentence distinguishing the two matters
    // MORE now, not less.
    expect(html()).toContain('This is the club')
  })

  it('carries the four hidden inputs the action reads back', () => {
    // `CLUB_LOCATION_FIELD_NAMES` is the contract between the field that writes
    // them and `readClubLocation`, which refuses anything short of all four.
    for (const name of ['location_name', 'location_place_id', 'latitude', 'longitude']) {
      expect(html()).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="${name}"`))
    }
  })

  it('renders with no rider town, which is the unsettled and the never-set state alike', () => {
    // Gated on the DATA, never on `isLoading`: the mock above returns
    // `undefined` and the form must simply render without a seed rather than
    // hold anything back waiting for one.
    expect(html()).toContain('Create club')
  })
})
