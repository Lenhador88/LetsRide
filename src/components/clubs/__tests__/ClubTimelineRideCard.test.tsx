import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClubTimelineRideCard } from '@/components/clubs/ClubTimelineRideCard'
import type { RideListItem } from '@/types'

/**
 * `097`'s follow-up, PD-366 (`design.md` §D9, task 11.7). `anchorKey` is
 * `mergeClubTimeline`'s own row key for this event (`ride:<uuid>`), drawn as
 * this card's DOM id so the club timeline can scroll back to it — the ride's
 * OWN link is unchanged and still opens the plain ride detail screen, which
 * has no return-anchor destination in this story (`RideHeader`'s `current
 * === 'plan'` back target is unconditional).
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

  it('does not carry a return anchor on its own ride link — that screen reads no such parameter', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineRideCard
        ride={ride()}
        at="2024-11-01T10:00:00Z"
        anchorKey="ride:11111111-1111-4111-8111-111111111111"
      />
    )

    expect(html).toContain('href="/rides/detail?id=11111111-1111-4111-8111-111111111111"')
  })
})
