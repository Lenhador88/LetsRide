// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublicProfile, RideCrew } from '@/types'

/**
 * **`ClubMemberRail.dom.test.tsx`'s mirror, and it exists because the fold-in
 * shipped without it.** A pre-merge review's finding: the ride rail took the
 * identical fix with strictly weaker coverage — static assertions only, so
 * nothing said its failed panel actually opens with a retry, and nothing at
 * all covered the retry state below.
 *
 * **jsdom rather than `renderToStaticMarkup`, and the reason is the event.**
 * `open` is local state and the panel is `{open && …}`, so under this repo's
 * default `environment: 'node'` there is no panel to assert against and a rail
 * that opened an empty box would pass every static case.
 */

let result: { data: RideCrew | undefined; error: Error | null } = { data: undefined, error: null }

/** Clears the error synchronously, exactly as `queryClient.ts`'s `refetch`
 * does — see the club rail's file for why a bare `vi.fn()` cannot see the
 * state this is here to pin. */
const refetch = vi.fn(() => {
  result = { data: undefined, error: null }
  act(() => {
    root.render(<RideCrewRail rideId="r1" organizerId="pl" organizer={host} isUpcoming />)
  })
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/rides/detail',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    useQuery: () => ({ ...result, isLoading: false, isRefetching: false, refetch }),
  }
})

const { RideCrewRail } = await import('@/components/rides/RideCrewRail')

const host: PublicProfile = {
  id: 'pl',
  username: 'pl',
  avatar_url: null,
  avatar_path: null,
  bike_model: null,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  refetch.mockClear()
  result = { data: undefined, error: new Error('Could not read who is riding') }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<RideCrewRail rideId="r1" organizerId="pl" organizer={host} isUpcoming />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function tapHeader() {
  const header = container.querySelector('button[aria-expanded]') as HTMLButtonElement
  act(() => {
    header.click()
  })
}

function tapRetry() {
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Try again'
  ) as HTMLButtonElement
  act(() => {
    retry.click()
  })
}

describe('RideCrewRail — tapping a failed rail', () => {
  it('expands in place instead of navigating, and says the read failed', () => {
    expect(container.querySelector('[role="alert"]')).toBeNull()

    tapHeader()

    expect(container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not load the crew'
    )
  })

  it('keeps the See all entrance to the crew page', () => {
    tapHeader()

    const link = container.querySelector('a')
    expect(link?.textContent).toBe('See all')
    expect(link?.getAttribute('href')).toContain('/rides/detail/crew')
  })

  it('stays open across the retry, so See all does not vanish while the rider waits', () => {
    tapHeader()
    tapRetry()

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(container.querySelector('a')?.textContent).toBe('See all')
  })
})
