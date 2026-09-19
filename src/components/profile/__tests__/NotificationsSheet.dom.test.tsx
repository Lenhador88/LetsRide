// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationsSheet } from '@/components/profile/NotificationsSheet'

/**
 * **The one thing here a refactor reverses in silence: the sheet inverts TWICE,
 * and dropping either `!` opts a rider out of the thing they just asked for.**
 *
 * The stored column is `digest_opt_out_at` and the checkbox is labelled *Send
 * me the weekly round-up*, so the value is negated once on the way in
 * (`!optOut.data` → `subscribed`) and once on the way out
 * (`setDigestOptOut(!nextSubscribed)`). Deleting either negation leaves a sheet
 * that renders, a checkbox that moves under the finger, and a write that
 * succeeds — with the rider's answer stored backwards. **Nothing else in the
 * repo would notice**: `tsc` sees a boolean either way, eslint sees nothing,
 * the RLS suite never reaches a React component, and the walk asks only whether
 * the screen rendered.
 *
 * That is why the write assertion below reads the ARGUMENT rather than merely
 * asserting the action was called. A test that only counted calls would pass
 * against both mutations, which is the failure mode this file exists to avoid.
 *
 * The second property is a copy one and it is about honesty rather than taste:
 * **this sheet must not promise a push.** `121`'s delivery chain is deployed
 * and inert — two provider credentials, `pg_cron`/`pg_net` and the Vault trio,
 * all owner-held (PD-303) — so a sentence mentioning a phone is a promise the
 * build cannot keep, which is exactly what `CLAUDE.md` says to audit
 * user-facing copy for. The pin is negative *and* positive, so that a future
 * trim cannot satisfy it by going silent: it must still say what the round-up
 * contains.
 *
 * Verified both ways per `CLAUDE.md` §Working Principles. Four mutations were
 * run against `NotificationsSheet.tsx` on this 5-test file, and the counts
 * below are MEASURED rather than predicted — two of the four broke more cases
 * than the obvious reading says they should. **Re-measure rather than adjust
 * these if the file changes.**
 *
 * - **drop the `!` at `subscribed`** (`override ?? optOut.data`) → **3 failed,
 *   2 passed**: *renders the box CHECKED…*, *stores an opt-out…* and *stores a
 *   subscribe…*. It takes all three because the read inversion feeds the write
 *   — the box starts unchecked, so both clicks send the opposite value. A
 *   single mutation breaking three cases is the expected shape for the value
 *   every other case reads through, not a sign the cases overlap.
 * - **drop the `!` at the write** (`setDigestOptOut(nextSubscribed)`) →
 *   **2 failed, 3 passed**: both write cases, and **the render case stays
 *   green**. That green is the point of the pair. It is what proves the write
 *   assertions are pinned to the ARGUMENT rather than riding on the render —
 *   a file asserting only *the box is checked* would have shipped this
 *   mutation, and a rider unticking the box would have stayed subscribed.
 * - **add "and we’ll send it to your phone" to the intro** → **1 failed, 4
 *   passed** — only *does not promise a push the delivery chain cannot send*.
 * - **replace the empty-week sentence** with "We put it together on Thursday
 *   evening." → **1 failed, 4 passed** — only *tells the rider a quiet week
 *   means nothing arrives*. Replaced rather than deleted, so the mutation
 *   tests the CLAIM rather than the paragraph's existence.
 *
 * jsdom, not `renderToStaticMarkup`: `ContextMenu` portals its sheet to
 * `document.body`, so a static render returns nothing at all — and two of the
 * five cases need a real click and the state update that follows it, which a
 * static render has no way to produce. Same reason as `PrivacySheet.dom.test.tsx`.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/profile',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))

const setDigestOptOut = vi.fn(async () => ({ error: null }))

vi.mock('@/lib/actions/profile', () => ({
  setDigestOptOut: (optOut: boolean) => setDigestOptOut(optOut),
}))

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    // `false` is "NOT opted out", i.e. subscribed — so the box must render
    // CHECKED. This is the state the inversion bug renders backwards, and it is
    // also the default every rider starts in, so it is the one worth fixing the
    // stub to.
    useQuery: () => ({ data: false, error: null, isLoading: false, refetch: () => {} }),
  }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setDigestOptOut.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<NotificationsSheet open onClose={() => {}} />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** The portalled sheet, which is on `document.body` rather than in `container`. */
const html = () => document.body.innerHTML

/** The one checkbox on the sheet. */
const box = () => document.body.querySelector('input[type="checkbox"]') as HTMLInputElement | null

/**
 * Tick or untick the box the way a rider does.
 *
 * **`click()`, never a synthesised `change` event** — React maps a checkbox's
 * `onChange` onto the native CLICK, so dispatching `change` updates the DOM
 * node and calls no handler at all. That failure reads exactly like a broken
 * component: the box moves, nothing is stored, and the assertion says the
 * action was called zero times. `PostcardMenu.test.tsx` dispatches clicks
 * through the same portal for the same reason.
 */
async function toggle(checkbox: HTMLInputElement) {
  await act(async () => {
    checkbox.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('NotificationsSheet', () => {
  it('renders the box CHECKED for a rider who has not opted out', () => {
    // The read-side inversion. `digest_opt_out_at` is null for every rider who
    // has never touched this, so "checked" is the state almost every rider sees
    // — and the state a dropped `!` renders backwards while looking fine.
    const checkbox = box()

    expect(checkbox).not.toBeNull()
    expect(checkbox?.checked).toBe(true)
  })

  it('stores an opt-out when the rider unticks the box', async () => {
    // **The write-side inversion, asserted on the ARGUMENT.** Unticking *Send
    // me the weekly round-up* means `digest_opt_out_at` must be STAMPED, so the
    // action has to receive `true` — the opposite of the checkbox's own value.
    // Counting calls instead of reading the argument would pass against the
    // mutation that deletes this negation, which is the whole point of the
    // case.
    const checkbox = box()!
    expect(checkbox.checked).toBe(true)

    await toggle(checkbox)

    expect(setDigestOptOut).toHaveBeenCalledTimes(1)
    expect(setDigestOptOut).toHaveBeenCalledWith(true)
  })

  it('stores a subscribe when the rider ticks it back on', async () => {
    // The other direction, so neither arm can be satisfied by a constant. A
    // mutation hard-coding `setDigestOptOut(true)` would pass the case above
    // and fail here.
    const checkbox = box()!

    await toggle(checkbox)
    await toggle(checkbox)

    expect(setDigestOptOut).toHaveBeenCalledTimes(2)
    expect(setDigestOptOut).toHaveBeenLastCalledWith(false)
  })

  it('does not promise a push the delivery chain cannot send', () => {
    // `121` is deployed and INERT — no APNs key, no FCM service account, no
    // `pg_cron`/`pg_net`, no Vault trio, and every one of those is owner-held
    // (PD-303). So this sheet describes the in-app round-up and says nothing
    // about a phone. Asserted negatively AND positively: a trim that simply
    // deletes the description would satisfy the first half while leaving a
    // rider with a checkbox and no idea what it turns on.
    const markup = html()

    expect(markup).not.toMatch(/phone|push notification/i)
    expect(markup).toContain('rides near you this weekend')
  })

  it('tells the rider a quiet week means nothing arrives', () => {
    // PD-450 makes the empty-week rule a REQUIREMENT, not an implementation
    // detail: "a rider with nothing to show gets NOTHING", because an empty
    // digest is worse than silence. Saying so here is what stops a rider
    // reading a quiet week as the feature being broken — and it is the sentence
    // most likely to be trimmed as filler by someone who has not read the
    // issue.
    expect(html()).toContain('only send it when there’s something in it')
  })
})
