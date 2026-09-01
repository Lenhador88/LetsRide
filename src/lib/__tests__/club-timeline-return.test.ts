import { describe, expect, it } from 'vitest'
import { RETURN_ANCHOR_PARAM, clubThreadFromTimeline, clubThreadReturnTo, routes } from '@/lib/routes'

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
