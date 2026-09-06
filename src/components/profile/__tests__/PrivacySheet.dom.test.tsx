// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrivacySheet } from '@/components/profile/PrivacySheet'

/**
 * **The one thing here a refactor reverses in silence: the rider is told their
 * screen is recorded BEFORE they are asked to consent.**
 *
 * PD-405 shortened this sheet on the product owner's instruction — the checkbox
 * is three words now and its sub-label is gone. What could not go with it is
 * the replay disclosure, which moved up into the intro paragraph. That leaves
 * the file one careless trim away from a sheet reading only `Share usage data`
 * over a switch that turns on session replay, which is the shape a regulator or
 * a store reviewer reads as consent that was not informed. Nothing else in the
 * repo would notice: the sheet still renders, the toggle still works, `tsc`
 * sees a string, and the walk asks only whether the screen loaded.
 *
 * So this asserts the fact **and its position**. Presence alone is not the
 * property — a disclosure below the checkbox is a disclosure the rider meets
 * after deciding, and `PrivacySheet`'s own docstring is explicit that being
 * above the toggle is the requirement rather than being present somewhere.
 *
 * Verified both ways per CLAUDE.md §Working Principles, with two mutations run
 * against `PrivacySheet.tsx`:
 *
 * - **deleting the replay clause** from the intro → 2 failed, 2 passed (both
 *   the presence and the order assertion, since a missing string has no
 *   position);
 * - **moving that clause below the `Checkbox`**, into the paragraph under it →
 *   **1 failed, 3 passed** — only *puts the recording disclosure above the
 *   toggle, not under it*.
 *
 * The second is the one that matters: it leaves the presence assertion green,
 * which is what proves the order assertion is pinned to the ORDER rather than
 * riding on the presence one. A file with only the first test would have
 * shipped that mutation.
 *
 * jsdom, not `renderToStaticMarkup`: `ContextMenu` portals its sheet to
 * `document.body`, so a static render of this component returns nothing at all
 * — the same reason `PostcardMenu.test.tsx` and `IntroductionPrompt.dom.test.tsx`
 * make this choice.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/profile',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))

// The two undo lists have their own tests and their own reads; stubbing them
// keeps this file about the consent copy rather than about `105`'s accessors.
vi.mock('@/components/profile/BlockedRidersList', () => ({
  BlockedRidersList: () => null,
}))
vi.mock('@/components/profile/HiddenPostcardsList', () => ({
  HiddenPostcardsList: () => null,
}))

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    // `false` is "not opted out", so the box renders checked — the state in
    // which the disclosure matters most, because the rider is being shown what
    // they are currently agreeing to.
    useQuery: () => ({ data: false, error: null, isLoading: false, refetch: () => {} }),
  }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<PrivacySheet open onClose={() => {}} />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** The portalled sheet, which is on `document.body` rather than in `container`. */
const html = () => document.body.innerHTML

describe('PrivacySheet', () => {
  it('names the screen recording before the rider consents', () => {
    // The wording may be reworded; that a replay of the rider's OWN screen is
    // named is the thing that may not go. Matched on the two words that carry
    // it rather than on the whole sentence, so a rewrite is free and a deletion
    // is not.
    expect(html()).toContain('replay of your own screen')
  })

  it('puts the recording disclosure above the toggle, not under it', () => {
    const markup = html()
    const disclosure = markup.indexOf('replay of your own screen')
    const checkbox = markup.indexOf('Share usage data')

    expect(disclosure).toBeGreaterThan(-1)
    expect(checkbox).toBeGreaterThan(-1)
    // Document order, which on this sheet is reading order: the intro paragraph
    // renders before the checkbox it qualifies.
    expect(disclosure).toBeLessThan(checkbox)
  })

  it('names all three collection categories, not the two that are easiest to keep', () => {
    // The pre-merge review's finding, and the reason it is pinned rather than
    // commented: the em-dash clause reads as a closed enumeration, so dropping
    // one category understates what is collected instead of merely saying less.
    // The first cut of PD-405's trim lost `moments` along with the sub-label it
    // came from, and every other gate stayed green.
    //
    // Ground truth is `/legal/privacy` (screens, moments, replay) and
    // `src/lib/analytics/events.ts`, which ships `ride_created`, `ride_joined`,
    // `club_joined`, `postcard_posted` and `onboarding_step` — the `moments`
    // category. This surface is what the App Store *Data Collection* and Play
    // *Data safety* forms get transcribed from (PD-232), so understating it
    // here is the expensive direction.
    const markup = html()

    expect(markup).toContain('screens you open')
    expect(markup).toContain('creating a ride')
    expect(markup).toContain('replay of your own screen')
  })

  it('keeps both claims about the rider’s data that the opt-out must not overstate', () => {
    const markup = html()

    // Trimming this paragraph is in scope (PD-405); deleting either of these is
    // not, because each is a claim about the rider's data rather than a
    // description of a feature. `/legal/privacy` says both in full.
    expect(markup).toContain('does not delete what has already')
    expect(markup).toContain('another rider')
  })

  it('no longer explains the mechanism at a rider who came to flip one switch', () => {
    // The sub-label PD-405 removed. Asserted as an absence so the tidy-up that
    // "restores helpful detail" has to argue with a red test rather than with a
    // comment — the owner asked for this sheet to say less.
    expect(html()).not.toContain('Never your password')
    expect(html()).not.toContain('Record how I use the app')
  })
})
