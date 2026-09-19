// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **This gates PD-210 on `/postcards`** — see the `/rides` sibling's header for
 * the full reasoning, including why it does NOT gate the blink PD-223 reports
 * (a failed RSC fetch makes `next/link` hard-reload the document, which no
 * mocked-`next/link` test can reproduce).
 *
 * This file exists because the collapsed gate was on both screens, and because
 * `PostcardsScreen` differs from `RidesScreen` in one relevant way: its deck
 * carries `key={`${filter?.kind}-${filter?.id}`}`, which forces the DECK to
 * remount on a filter change **by design**. `PostcardDeck` is mocked to `null`
 * here, which sidesteps that rather than reasoning around it — acceptable only
 * because the assertion is about a DIFFERENT element's identity (the `<nav>`),
 * and the deck's own remount is `PostcardDeck`'s to test. If this file ever
 * starts asserting anything about the deck, unmock it first.
 */

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const FILTERS = {
  total: 4,
  collage: [] as string[],
  riders: [
    { kind: 'rider' as const, id: 'r1', name: 'Rider One', imageUrl: null, coverUrl: null, count: 2 },
  ],
  clubs: [] as never[],
}
const getPostcardFilters = vi.fn(() => delay(FILTERS, 40))
const getFeed = vi.fn(() => delay([], 40))

vi.mock('@/lib/data/postcards', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/postcards')>('@/lib/data/postcards')
  return {
    ...actual,
    getPostcardFilters: () => getPostcardFilters(),
    getFeed: () => getFeed(),
  }
})

vi.mock('@/components/layout/Header', () => ({ Header: () => null }))
vi.mock('@/components/notifications/NotificationsHeaderControl', () => ({
  NotificationsHeaderControl: () => null,
}))
vi.mock('@/components/postcards/PostcardDeck', () => ({
  PostcardDeck: () => null,
}))

let currentSearch = new URLSearchParams('')
const searchListeners = new Set<() => void>()
function setSearch(next: URLSearchParams) {
  currentSearch = next
  searchListeners.forEach((l) => l())
}

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    useSyncExternalStore(
      (cb: () => void) => {
        searchListeners.add(cb)
        return () => searchListeners.delete(cb)
      },
      () => currentSearch,
      () => currentSearch
    ),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => {
    return createElement(
      'a',
      {
        href,
        ...rest,
        onClick: (e: { preventDefault: () => void }) => {
          e.preventDefault()
          const qIndex = href.indexOf('?')
          setSearch(new URLSearchParams(qIndex === -1 ? '' : href.slice(qIndex + 1)))
        },
      },
      children
    )
  },
}))

const { default: PostcardsPage } = await import('@/app/(app)/postcards/page')

describe('PD-223 — the postcards filter bar survives a filter tap', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    currentSearch = new URLSearchParams('')
    searchListeners.clear()
    getPostcardFilters.mockClear()
    getFeed.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps the same <nav> element mounted across a filter tap', async () => {
    await act(async () => {
      root.render(<PostcardsPage />)
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    const barBefore = container.querySelector('nav[aria-label="Filter postcards"]')
    expect(barBefore, 'the filter bar must be mounted once cold load settles').toBeTruthy()

    // Starting search is empty (the "All new" filter already), so the tap
    // has to land on a DIFFERENT tile to exercise a real filter change — the
    // fixture rider tile, `?rider=r1`.
    const tile = container.querySelector('a[href="/postcards?rider=r1"]') as HTMLAnchorElement | null
    expect(tile, 'the rider filter tile must be mounted').toBeTruthy()

    const sawBarMissing: boolean[] = []
    const poll = setInterval(() => {
      sawBarMissing.push(!container.querySelector('nav[aria-label="Filter postcards"]'))
    }, 1)

    await act(async () => {
      tile!.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })
    clearInterval(poll)

    const barAfter = container.querySelector('nav[aria-label="Filter postcards"]')
    expect(barAfter, 'the filter bar must still be mounted after the tap').toBeTruthy()
    expect(barAfter, 'it must be the SAME element — a new one means it unmounted and remounted').toBe(
      barBefore
    )
    expect(sawBarMissing.some(Boolean), 'the bar must never be absent from the DOM mid-transition').toBe(
      false
    )

    // ** WITHOUT THIS THE WHOLE FILE IS VACUOUS. ** Verified: delete the
    // `setSearch` call from the `next/link` mock above and every assertion
    // below still passes — a bar that never had to survive anything is
    // trivially the same element. So the tap has to be PROVED to have landed,
    // and `aria-current` is the proof that travels furthest: it moves only if
    // the click reached the router stand-in, the page re-parsed the search
    // string, and the real bar re-rendered with a new `active`.
    expect(
      tile!.getAttribute('aria-current'),
      'the tapped tile must be selected AFTER the tap — otherwise the navigation never landed and this test proves nothing'
    ).toBe('true')
    expect(
      barBefore!.querySelector('a[aria-current="true"]'),
      'exactly one tile is current, and it is the tapped one'
    ).toBe(tile)
  })
})
