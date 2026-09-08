import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PublicProfile, RideCrew } from '@/types'

/**
 * **The failed read — `ClubMemberRail.states.test.tsx`'s twin, and it exists
 * because the defect was.**
 *
 * PD-382 was reported against the club screen, but this rail shipped the
 * identical fallback: `roster.error` returned a `<Link>` to the crew page
 * wearing the rail's own box, height and chevron, so a failed read looked like
 * a working rail that navigates instead of expanding. Fixing one and leaving
 * the other is `CLAUDE.md`'s *individually correct and collectively
 * inconsistent*, and the report would simply have come back one screen over.
 *
 * Same property, same both-ways check: **the collapsed rail is a disclosure
 * button and never an anchor, whatever the read did** — asserted in the loaded
 * state too, so a regression turning every state into a link cannot pass.
 *
 * `environment: 'node'` — nothing here needs an event or a layout.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/rides/detail',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))

let result: { data: RideCrew | undefined; error: Error | null } = { data: undefined, error: null }

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    useQuery: () => ({ ...result, isLoading: false, isRefetching: false, refetch: () => {} }),
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

function render() {
  return renderToStaticMarkup(
    <RideCrewRail rideId="r1" organizerId="pl" organizer={host} isUpcoming />
  )
}

describe('RideCrewRail — the failed read', () => {
  it('stays a disclosure button rather than becoming a link to the crew page', () => {
    result = { data: undefined, error: new Error('Could not read who is riding') }

    const html = render()

    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('<a')
  })

  it('labels the section without inventing a count it does not have', () => {
    result = { data: undefined, error: new Error('Could not read who is riding') }

    const html = render()

    expect(html).toContain('riding')
    expect(html).not.toMatch(/\d+ (going|rode)/)
  })

  it('draws the crew it already holds rather than blanking it for a failed refetch', () => {
    result = { data: { going: [{ user_id: 'mk', profile: null, is_host: false }], maybe: [] }, error: new Error('offline') }

    const html = render()

    expect(html).toContain('2 going')
  })

  it('is a button in the loaded state too — the property is not error-only', () => {
    result = { data: { going: [], maybe: [] }, error: null }

    const html = render()

    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('<a')
  })
})
