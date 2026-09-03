import { describe, expect, it } from 'vitest'
import {
  RETURN_ANCHOR_PARAM,
  clubThreadFromTimeline,
  clubThreadReturnTo,
  rideFromClubTimeline,
  rideReturnTo,
  routes,
} from '@/lib/routes'

/**
 * The pure half of "Back from a thread returns to the club at that row"
 * (PD-366, `design.md` §D9) — the surrounding screen reads `useSearchParams()`
 * and `window.location`, neither of which this node-environment suite can
 * render, so what is left testable is the parse and the fallback:
 * `backFromCreateScreen`'s own precedent for exactly this shape.
 */
const CLUB = '11111111-2222-4333-8444-555555555555'
const THREAD = '22222222-3333-4444-8555-666666666666'
const JOIN_ANCHOR = 'join:33333333-4444-4555-8666-777777777777'

describe('clubThreadFromTimeline', () => {
  it('carries the thread id and the anchor as two query parameters', () => {
    const link = clubThreadFromTimeline(THREAD, JOIN_ANCHOR)

    expect(link).toBe(`/clubs/detail/thread?id=${THREAD}&${RETURN_ANCHOR_PARAM}=join%3A33333333-4444-4555-8666-777777777777`)

    const carried = new URLSearchParams(link.split('?')[1]).get(RETURN_ANCHOR_PARAM)
    expect(carried).toBe(JOIN_ANCHOR)
  })
})

describe('clubThreadReturnTo', () => {
  it('returns the thread list when no anchor was carried', () => {
    expect(clubThreadReturnTo(CLUB, null)).toBe(routes.clubThreads(CLUB))
  })

  it('returns the thread list for an empty string', () => {
    expect(clubThreadReturnTo(CLUB, '')).toBe(routes.clubThreads(CLUB))
  })

  it('returns the club with a fragment for a well-formed anchor', () => {
    expect(clubThreadReturnTo(CLUB, JOIN_ANCHOR)).toBe(`${routes.club(CLUB)}#${JOIN_ANCHOR}`)
  })

  it('accepts all six kinds `mergeClubTimeline` can produce', () => {
    const id = '44444444-5555-4666-8777-888888888888'
    for (const kind of ['ride', 'postcard', 'thread', 'join', 'reply', 'club-created']) {
      const anchor = `${kind}:${id}`
      expect(clubThreadReturnTo(CLUB, anchor)).toBe(`${routes.club(CLUB)}#${anchor}`)
    }
  })

  it('falls back rather than building a fragment from a malformed value', () => {
    // Never a URL and never an open redirect: an unknown prefix, a non-uuid
    // remainder, and a bare path all fall back identically.
    expect(clubThreadReturnTo(CLUB, 'not-an-anchor')).toBe(routes.clubThreads(CLUB))
    expect(clubThreadReturnTo(CLUB, 'ride:not-a-uuid')).toBe(routes.clubThreads(CLUB))
    expect(clubThreadReturnTo(CLUB, 'seventh-kind:44444444-5555-4666-8777-888888888888')).toBe(
      routes.clubThreads(CLUB)
    )
    expect(clubThreadReturnTo(CLUB, 'https://example.com')).toBe(routes.clubThreads(CLUB))
    expect(clubThreadReturnTo(CLUB, '../../etc/passwd')).toBe(routes.clubThreads(CLUB))
  })

  it('round-trips through the parameter the thread page reads', () => {
    const link = clubThreadFromTimeline(THREAD, JOIN_ANCHOR)
    const carried = new URLSearchParams(link.split('?')[1]).get(RETURN_ANCHOR_PARAM)

    expect(clubThreadReturnTo(CLUB, carried)).toBe(`${routes.club(CLUB)}#${JOIN_ANCHOR}`)
  })
})

/**
 * PD-378 — the same trip for a ride. The ride screen's Back was unconditional
 * (`/rides`) until this story, so a rider who opened a ride from a club
 * timeline left the club altogether and came back to the top of it.
 *
 * `RIDES` is the fallback its one caller passes (`RideHeader`), spelled here
 * rather than imported because it is a literal in that component and not a
 * member of `routes`.
 */
const RIDE = '55555555-6666-4777-8888-999999999999'
const RIDE_ANCHOR = `ride:${RIDE}`
const RIDES = '/rides'

describe('rideFromClubTimeline', () => {
  it('carries the ride id and the anchor as two query parameters', () => {
    const link = rideFromClubTimeline(RIDE, RIDE_ANCHOR)

    expect(link).toBe(`/rides/detail?id=${RIDE}&${RETURN_ANCHOR_PARAM}=ride%3A${RIDE}`)

    const carried = new URLSearchParams(link.split('?')[1]).get(RETURN_ANCHOR_PARAM)
    expect(carried).toBe(RIDE_ANCHOR)
  })

  it('uses the SAME parameter name the thread link uses', () => {
    // One name, so `clubTimelineAnchorSchema` bounds both and a future reader
    // cannot conclude the two screens carry different things.
    const ridePart = rideFromClubTimeline(RIDE, RIDE_ANCHOR).split('&')[1]
    const threadPart = clubThreadFromTimeline(THREAD, JOIN_ANCHOR).split('&')[1]

    expect(ridePart.split('=')[0]).toBe(threadPart.split('=')[0])
  })
})

describe('rideReturnTo', () => {
  it('returns the club at that row when the club and the anchor are both good', () => {
    expect(rideReturnTo(CLUB, RIDE_ANCHOR, RIDES)).toBe(`${routes.club(CLUB)}#${RIDE_ANCHOR}`)
  })

  it('falls back while the ride is still being read — a null club is the ordinary loading state', () => {
    // The club comes off `ride.club_id`, which arrives with the ride. This is
    // the window `RideHeader`'s docstring prices: today's destination, not a
    // broken one.
    expect(rideReturnTo(null, RIDE_ANCHOR, RIDES)).toBe(RIDES)
    expect(rideReturnTo(undefined, RIDE_ANCHOR, RIDES)).toBe(RIDES)
  })

  it('falls back for a ride that belongs to no club at all', () => {
    // `rides.club_id` is nullable, and a clubless ride reached by a hand-made
    // URL carrying an anchor must not build `routes.club(null)`.
    expect(rideReturnTo(null, RIDE_ANCHOR, RIDES)).toBe(RIDES)
  })

  it('falls back when no anchor was carried — every other route into a ride', () => {
    // The rides list, Explore, a notification tap, a pasted link.
    expect(rideReturnTo(CLUB, null, RIDES)).toBe(RIDES)
    expect(rideReturnTo(CLUB, undefined, RIDES)).toBe(RIDES)
    expect(rideReturnTo(CLUB, '', RIDES)).toBe(RIDES)
  })

  it('accepts all six kinds, not just `ride:` — the parameter is the shared one', () => {
    const id = '44444444-5555-4666-8777-888888888888'
    for (const kind of ['ride', 'postcard', 'thread', 'join', 'reply', 'club-created']) {
      expect(rideReturnTo(CLUB, `${kind}:${id}`, RIDES)).toBe(`${routes.club(CLUB)}#${kind}:${id}`)
    }
  })

  it('never builds a URL from a malformed anchor, and never an open redirect', () => {
    for (const bad of [
      'not-an-anchor',
      'ride:not-a-uuid',
      'seventh-kind:44444444-5555-4666-8777-888888888888',
      'https://example.com',
      '../../etc/passwd',
    ]) {
      expect(rideReturnTo(CLUB, bad, RIDES)).toBe(RIDES)
    }
  })

  it('never builds a URL from a malformed CLUB either', () => {
    // The club is read off the ride rather than the URL, so this is defence in
    // depth rather than the front line — but a helper that trusted it would be
    // one refactor away from taking it from a query parameter.
    for (const bad of ['not-a-uuid', 'https://example.com', '../../etc/passwd']) {
      expect(rideReturnTo(bad, RIDE_ANCHOR, RIDES)).toBe(RIDES)
    }
  })

  it('round-trips through the parameter the ride page reads', () => {
    const link = rideFromClubTimeline(RIDE, RIDE_ANCHOR)
    const carried = new URLSearchParams(link.split('?')[1]).get(RETURN_ANCHOR_PARAM)

    expect(rideReturnTo(CLUB, carried, RIDES)).toBe(`${routes.club(CLUB)}#${RIDE_ANCHOR}`)
  })
})
