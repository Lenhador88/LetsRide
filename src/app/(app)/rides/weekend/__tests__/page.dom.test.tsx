// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import type { WeekendDigest } from '@/types'

/**
 * `/rides/weekend`'s no-position row — PD-450, part 1, task 5.2.
 *
 * **The one thing a refactor reverses in silence: `TownQuestionSheet` opening
 * on its own rather than on a tap.** `design.md` §D6 is explicit that this
 * screen carries no dismissal ladder of its own — unlike `LocationQuestionRow`,
 * which opens a priming sheet automatically once a device fix is denied — so
 * the ONLY route to the sheet here is the rider's own tap on the no-position
 * row. A regression that renders `<TownQuestionSheet open />` unconditionally,
 * or that opens it in a mount effect, is invisible to `tsc`, ESLint and the
 * walk (which only asks whether the screen rendered) — this file is the one
 * gate that would catch it.
 *
 * jsdom, not `renderToStaticMarkup`: the assertion turns on a click, and
 * `TownQuestionSheet` is a `ContextMenu` that portals to `document.body` —
 * stubbed here to a plain marker so the click is about THIS screen's own
 * decision rather than about `PlaceSearchField`'s network calls, which
 * `LocationQuestionRow.dom.test.tsx` already stubs for the identical reason.
 *
 * Verified both ways: hard-coding `open={true}` on `TownQuestionSheet` in
 * `page.tsx` — the auto-open regression this file exists to catch — fails
 * BOTH cases above, measured.
 */

const { queryStore, useQueryImpl, seedQuery } = vi.hoisted(() => {
  const queryStore = new Map<string, unknown>()
  function useQueryImpl(key: readonly unknown[] | null) {
    if (key === null) {
      return { data: undefined, error: null, isLoading: false, refetch: () => {} }
    }
    return {
      data: queryStore.get(JSON.stringify(key)),
      error: null,
      isLoading: false,
      refetch: () => {},
    }
  }
  function seedQuery(key: readonly unknown[], value: unknown) {
    queryStore.set(JSON.stringify(key), value)
  }
  return { queryStore, useQueryImpl, seedQuery }
})

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return { ...actual, useQuery: (key: readonly unknown[] | null) => useQueryImpl(key) }
})

vi.mock('@/components/location/TownQuestionSheet', () => ({
  TownQuestionSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="town-sheet" /> : null,
}))

const { default: WeekendDigestPage } = await import('@/app/(app)/rides/weekend/page')

const EMPTY_DIGEST: WeekendDigest = { rides: [], clubs: [] }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  queryStore.clear()
  // Position DECIDED and null — `design.md`'s no-position state — with the
  // digest itself empty, so nothing but the row under test has a reason to
  // render.
  seedQuery(queryKeys.riderLocation(), null)
  seedQuery(queryKeys.profile.location(), null)
  seedQuery(queryKeys.rides.weekend(null), EMPTY_DIGEST)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount() {
  act(() => {
    root.render(<WeekendDigestPage />)
  })
}

/** The one row this state draws — see `NoPositionRow` in `page.tsx`. */
const row = () => document.body.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement | null

const sheet = () => document.body.querySelector('[data-testid="town-sheet"]')

describe('the no-position row', () => {
  it('renders the row and does not open TownQuestionSheet on its own', () => {
    mount()

    expect(row()).not.toBeNull()
    expect(row()?.textContent).toContain('Set where you ride from')
    expect(sheet()).toBeNull()
  })

  it('opens TownQuestionSheet only once the row is tapped', () => {
    mount()
    expect(sheet()).toBeNull()

    act(() => {
      row()!.click()
    })

    expect(sheet()).not.toBeNull()
  })
})
