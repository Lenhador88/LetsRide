// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PD-223 — "the filter bar still blinks out on a filter tap".
 *
 * Mounts the REAL `/rides` page component with only its data sources and
 * heavier presentational children stubbed out, and drives a filter tap the
 * same way a rider's finger does: a `next/link` click that changes only the
 * search string. `next/navigation`'s `useSearchParams` is backed by a tiny
 * external store here, so the click causes a genuine React state update in
 * the mounted tree rather than a full remount driven by the test.
 *
 * The property under test is DOM node identity, not text content: the real
 * `<nav aria-label="Filter rides">` element is captured before the tap and
 * compared by reference afterward. Content can legitimately change (a
 * skeleton replacing a bar draws different text); node identity cannot
 * survive an unmount, which is what "blinks out" means.
 */

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const FILTERS = { mine: 2, fromClubs: 3, clubs: [] as never[] }
const getRideFilters = vi.fn(() => delay(FILTERS, 40))
const getRides = vi.fn((filter: unknown) =>
  delay({ upcoming: [], past: [] }, 40).then((r) => {
    void filter
    return r
  })
)
const getExploreRides = vi.fn(() => Promise.resolve([]))

vi.mock('@/lib/data/rides', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/rides')>('@/lib/data/rides')
  return {
    ...actual,
    getRideFilters: () => getRideFilters(),
    getRides: (filter: unknown) => getRides(filter),
    getExploreRides: () => getExploreRides(),
  }
})

vi.mock('@/lib/location/use-rider-position', () => ({
  useRiderPosition: () => ({ position: null, settled: true }),
  useNearLabel: () => null,
}))

vi.mock('@/components/layout/Header', () => ({
  Header: () => null,
}))
vi.mock('@/components/notifications/NotificationsHeaderControl', () => ({
  NotificationsHeaderControl: () => null,
}))
vi.mock('@/components/rides/ExploreRidesStrip', () => ({
  ExploreRidesStrip: () => null,
}))
vi.mock('@/components/rides/MapAttribution', () => ({
  MapAttribution: () => null,
}))
vi.mock('@/components/rides/RideCard', () => ({
  RideCard: () => null,
}))

// A tiny external store standing in for the App Router's real search-params
// context — changed only by the mocked `next/link` below, exactly as a real
// navigation changes only the URL and nothing else in an already-mounted,
// fully client-rendered page.
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

const { default: RidesPage } = await import('@/app/(app)/rides/page')

describe('PD-223 — the rides filter bar survives a filter tap', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    currentSearch = new URLSearchParams('')
    searchListeners.clear()
    getRideFilters.mockClear()
    getRides.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps the same <nav> element mounted across a filter tap, with no fallback in between', async () => {
    await act(async () => {
      root.render(<RidesPage />)
    })
    // Let the cold-load fetches (getRideFilters, getRides) resolve.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    const barBefore = container.querySelector('nav[aria-label="Filter rides"]')
    expect(barBefore, 'the filter bar must be mounted once cold load settles').toBeTruthy()

    const tile = container.querySelector('a[href="/rides?filter=mine"]') as HTMLAnchorElement | null
    expect(tile, 'the "Your rides" tile must be mounted').toBeTruthy()

    // Watch every commit between the click and the settled re-render for the
    // bar's absence — a MutationObserver-free approach: React 19's act()
    // flushes synchronously inside this callback, so recording container
    // snapshots on a microtask cadence catches every intermediate paint.
    const sawBarMissing: boolean[] = []
    const poll = setInterval(() => {
      sawBarMissing.push(!container.querySelector('nav[aria-label="Filter rides"]'))
    }, 1)

    await act(async () => {
      tile!.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })
    clearInterval(poll)

    const barAfter = container.querySelector('nav[aria-label="Filter rides"]')
    expect(barAfter, 'the filter bar must still be mounted after the tap').toBeTruthy()
    expect(barAfter, 'it must be the SAME element — a new one means it unmounted and remounted').toBe(
      barBefore
    )
    expect(sawBarMissing.some(Boolean), 'the bar must never be absent from the DOM mid-transition').toBe(
      false
    )
  })
})
