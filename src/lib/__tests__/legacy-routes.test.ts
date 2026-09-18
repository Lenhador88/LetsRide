import { describe, expect, it } from 'vitest'
import { LEGACY_DETAIL_ROUTES, legacyRouteTarget } from '@/lib/legacy-routes'

/**
 * The table had one reader — `next.config.ts`'s `redirects()` — and
 * `scripts/native/export-guards.mjs` checks *that* reader against what Next
 * compiled. PD-205 added a second reader with no server behind it
 * (`deepLinkTarget`), so the mapping itself now needs cases of its own.
 *
 * Every case here is a URL that can arrive from outside the app: a link in
 * somebody's WhatsApp, an old bookmark, a notification. The ones that must
 * answer `null` matter more than the ones that map — a false positive rewrites
 * a live route.
 */
describe('legacyRouteTarget', () => {
  const ID = '11111111-2222-3333-4444-555555555555'

  it('maps the pre-PD-142 detail shapes, id and all', () => {
    expect(legacyRouteTarget(`/postcards/${ID}`)).toBe(`/postcards/detail?id=${ID}`)
    expect(legacyRouteTarget(`/rides/${ID}`)).toBe(`/rides/detail?id=${ID}`)
    expect(legacyRouteTarget(`/rides/${ID}/crew`)).toBe(`/rides/detail/crew?id=${ID}`)
    expect(legacyRouteTarget(`/clubs/${ID}/members`)).toBe(`/clubs/detail/members?id=${ID}`)
    expect(legacyRouteTarget(`/clubs/${ID}/about`)).toBe(`/clubs/detail/about?id=${ID}`)
  })

  it('covers every pair in the table, so a pair added later is not silently untested', () => {
    for (const [base, tail] of LEGACY_DETAIL_ROUTES) {
      expect(legacyRouteTarget(`${base}/${ID}${tail}`)).toBe(`${base}/detail${tail}?id=${ID}`)
    }
  })

  it('sends both retired chat shapes to the ride', () => {
    expect(legacyRouteTarget(`/rides/${ID}/chat`)).toBe(`/rides/detail?id=${ID}`)
    // The query rides through, exactly as Next appends an incoming query to a
    // destination that does not specify one.
    expect(legacyRouteTarget('/rides/detail/chat', `?id=${ID}`)).toBe(`/rides/detail?id=${ID}`)
    expect(legacyRouteTarget('/rides/detail/chat')).toBe('/rides/detail')
  })

  /**
   * The half that would be a live bug rather than a loose end. `next.config.ts`
   * records the measurement: an unconstrained `/rides/:id` swallows
   * `/rides/new`, `/clubs/:id` swallows `/clubs/explore`, and `/rides/:id`
   * swallows `/rides/detail` itself — `/rides/detail?id=detail`, in a loop.
   */
  it('leaves every live route alone', () => {
    for (const live of [
      '/',
      '/rides',
      '/rides/new',
      '/rides/detail',
      '/rides/detail/crew',
      '/rides/join',
      '/clubs',
      '/clubs/new',
      '/clubs/explore',
      '/clubs/detail',
      '/postcards',
      '/postcards/new',
      '/profile',
      '/auth/login',
      '/auth/confirm',
      '/legal/terms',
      '/onboarding/town',
    ]) {
      expect(legacyRouteTarget(live)).toBeNull()
    }
  })

  it('refuses an id that is not a UUID, which is what keeps the live routes above safe', () => {
    expect(legacyRouteTarget('/rides/detail')).toBeNull()
    expect(legacyRouteTarget('/rides/not-a-uuid')).toBeNull()
    // One character short, and one over.
    expect(legacyRouteTarget('/rides/11111111-2222-3333-4444-55555555555')).toBeNull()
    expect(legacyRouteTarget('/rides/11111111-2222-3333-4444-5555555555555')).toBeNull()
    // A UUID under a base that never had this shape.
    expect(legacyRouteTarget(`/profile/${ID}`)).toBeNull()
    // A tail that is not one of the table's.
    expect(legacyRouteTarget(`/clubs/${ID}/treasurer`)).toBeNull()
  })

  it('does not match a UUID buried deeper in the path', () => {
    expect(legacyRouteTarget(`/rides/${ID}/crew/extra`)).toBeNull()
    expect(legacyRouteTarget(`/x/rides/${ID}`)).toBeNull()
  })
})
