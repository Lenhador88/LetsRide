import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClubTimelineRideCard } from '@/components/clubs/ClubTimelineRideCard'
import type { RideListItem } from '@/types'

/**
 * `097`'s follow-up, PD-366 (`design.md` §D9, task 11.7), then PD-378.
 *
 * `anchorKey` is `mergeClubTimeline`'s own row key for this event
 * (`ride:<uuid>`) and it now does BOTH halves of the return trip: it is this
 * card's DOM id, so the club timeline can scroll back to it, and it rides out
 * on the ride's own link so that ride's Back can come back to it.
 *
 * **The second test below asserted the opposite until PD-378** — that the ride
 * link carried no anchor, because `RideHeader`'s `current === 'plan'` back
 * target was unconditional and a parameter nothing read would have been a
 * prefill for no one. PD-378 made the ride screen read it, so the assertion is
 * inverted rather than deleted: one identity for the row, carried both ways.
 *
 * `environment: 'node'`, `RideCard.test.tsx`'s own fixture shape.
 */
const ride = (over: Partial<RideListItem> = {}): RideListItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Ardennes loop',
  meeting_point: 'Amsterdam Centraal',
  departure_at: '2024-11-16T10:00:00Z',
  created_at: '2024-11-01T10:00:00Z',
  timezone: null,
  club: null,
  latitude: 52.38,
  longitude: 4.9,
  organizer: null,
  riders: [],
  riders_count: 1,
  attendance: null,
  map_card_url: null,
  is_upcoming: true,
  ...over,
})

describe('ClubTimelineRideCard — the row anchor, PD-366', () => {
  it('carries `anchorKey` as its own DOM id', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineRideCard
        ride={ride()}
        at="2024-11-01T10:00:00Z"
        anchorKey="ride:11111111-1111-4111-8111-111111111111"
      />
    )

    expect(html).toContain('id="ride:11111111-1111-4111-8111-111111111111"')
  })

  it('carries the SAME anchor out on its ride link, so the ride can come back to this row — PD-378', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineRideCard
        ride={ride()}
        at="2024-11-01T10:00:00Z"
        anchorKey="ride:11111111-1111-4111-8111-111111111111"
      />
    )

    expect(html).toContain(
      'href="/rides/detail?id=11111111-1111-4111-8111-111111111111&amp;row=ride%3A11111111-1111-4111-8111-111111111111"'
    )
  })

  it('sends the row id it drew, not a second identity — the DOM id and the link agree', () => {
    // The whole mechanism rests on these being one string: the fragment the
    // rider returns on has to name an element that is on the page. A change
    // that derived the outbound anchor from the ride id instead would still
    // pass the test above for a `ride:` row and silently break every other
    // kind, so this asserts the two against each other rather than against a
    // literal.
    const anchorKey = 'ride:11111111-1111-4111-8111-111111111111'
    const html = renderToStaticMarkup(
      <ClubTimelineRideCard ride={ride()} at="2024-11-01T10:00:00Z" anchorKey={anchorKey} />
    )

    expect(html).toContain(`id="${anchorKey}"`)
    expect(html).toContain(`row=${encodeURIComponent(anchorKey)}`)
  })
})
