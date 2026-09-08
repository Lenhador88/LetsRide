import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ClubRosterMember, PublicProfile } from '@/types'

/**
 * **The failed read, which PD-382 is the report of.**
 *
 * The rail used to answer `roster.error` by returning a `<Link>` to
 * `/clubs/detail/members` wearing the rail's own box, height and chevron. On
 * the screen that is a Members section which navigates instead of expanding —
 * the owner's report word for word — and it is indistinguishable from a
 * working rail, which is why reading the source's happy path (a `<button>`
 * that toggles local state) said the premise was void for five days.
 *
 * So this file pins the property rather than the markup: **the collapsed rail
 * is a disclosure button and never an anchor, whatever the read did.** Verified
 * both ways — the loaded case asserts the same thing, so a regression that
 * turned *every* state into a link would not pass by satisfying only the
 * error case, and the `See all` anchor inside the open panel is deliberately
 * out of this file's reach (it lives behind a tap, in the `.dom` file).
 *
 * `environment: 'node'` — `renderToStaticMarkup` answers "what does the
 * collapsed rail render", and nothing here needs an event or a layout.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/clubs/detail',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))

let result: { data: ClubRosterMember[] | undefined; error: Error | null } = {
  data: undefined,
  error: null,
}

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    useQuery: () => ({ ...result, isLoading: false, isRefetching: false, refetch: () => {} }),
  }
})

const { ClubMemberRail } = await import('@/components/clubs/ClubMemberRail')

function member(id: string, role: ClubRosterMember['role'] = 'member'): ClubRosterMember {
  const profile: PublicProfile = {
    id,
    username: id,
    avatar_url: null,
    avatar_path: null,
    bike_model: null,
  }
  return { user_id: id, role, joined_at: '2024-01-01T00:00:00Z', profile }
}

function render() {
  return renderToStaticMarkup(<ClubMemberRail clubId="c1" />)
}

describe('ClubMemberRail — the failed read', () => {
  it('stays a disclosure button rather than becoming a link to the members page', () => {
    result = { data: undefined, error: new Error('Could not read this club’s members') }

    const html = render()

    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('<a')
  })

  it('labels the section without inventing a count it does not have', () => {
    result = { data: undefined, error: new Error('Could not read this club’s members') }

    const html = render()

    expect(html).toContain('Members')
    expect(html).not.toMatch(/\d+ members?/)
  })

  it('draws the roster it already holds rather than blanking it for a failed refetch', () => {
    result = { data: [member('pl', 'owner'), member('mk')], error: new Error('offline') }

    const html = render()

    expect(html).toContain('2 members')
  })

  it('is a button in the loaded state too — the property is not error-only', () => {
    result = { data: [member('pl', 'owner')], error: null }

    const html = render()

    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('<a')
  })
})
