// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClubRosterMember } from '@/types'

/**
 * **What the failed rail does when a rider actually taps it** — the half
 * `ClubMemberRail.states.test.tsx` cannot reach.
 *
 * That file asserts the collapsed rail is a button and not a link, which is
 * the regression PD-382 reported. It cannot say what the button *opens*,
 * because the panel is unmounted while closed and mounting it needs a real
 * click. Without this file the rail could satisfy every static assertion and
 * still open an empty box — a Members section that expands into nothing is a
 * different bug wearing the same fix.
 *
 * **jsdom rather than `renderToStaticMarkup`, and the reason is the event.**
 * `open` is local state and the panel is `{open && …}`, so under this repo's
 * default `environment: 'node'` there is nothing to assert. Both cases here
 * are a `click` and its re-render.
 */

const refetch = vi.fn()
let result: { data: ClubRosterMember[] | undefined; error: Error | null } = {
  data: undefined,
  error: null,
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/clubs/detail',
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

const { ClubMemberRail } = await import('@/components/clubs/ClubMemberRail')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  refetch.mockClear()
  result = { data: undefined, error: new Error('Could not read this club’s members') }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<ClubMemberRail clubId="c1" />)
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

describe('ClubMemberRail — tapping a failed rail', () => {
  it('expands in place instead of navigating, and says the read failed', () => {
    expect(container.querySelector('[role="alert"]')).toBeNull()

    tapHeader()

    expect(container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not load the members'
    )
  })

  it('keeps the See all entrance to the roster page — PD-262 is not reversed by the error state', () => {
    tapHeader()

    const link = container.querySelector('a')
    expect(link?.textContent).toBe('See all')
    expect(link?.getAttribute('href')).toContain('/clubs/detail/members')
  })

  it('retries the read rather than leaving the rider with a dead panel', () => {
    tapHeader()

    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again'
    ) as HTMLButtonElement
    act(() => {
      retry.click()
    })

    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
