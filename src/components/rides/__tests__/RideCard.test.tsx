import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RideCard } from '@/components/rides/RideCard'
import type { RideListItem } from '@/types'

/**
 * The two things PD-340 added to this card, and both are contracts a plausible
 * refactor reverses without looking wrong.
 *
 * **The distance clause is absent when there is nothing to say.** `distance_km`
 * is `undefined` on every row that no read attached one to — which is every row
 * on `/rides` and `/clubs/detail/rides` until the rider's position resolves, and
 * every row for a rider who has never granted location and set no profile city.
 * A card that rendered `0 km away`, `NaN km away` or an empty separator dot in
 * that state would be wrong on most of the list, and it screenshots as a
 * one-character artifact nobody reports.
 *
 * **The meeting point truncates and the distance does not.** They share a line,
 * so one of the two has to give — and a refactor that moves `shrink-0` onto the
 * wrong span, or drops `min-w-0` from the name, produces a card that looks
 * identical against a short address and loses `12 km away` off the right edge
 * against a long one. That is the same shape as `PostcardCard`'s geometry test:
 * one class either way, reversible in silence, and plausible in any single
 * screenshot.
 *
 * **The day band is asserted here only as far as it reaches the markup.** The
 * bands themselves are `formatRideCardDay`'s, tested against fixed clocks in
 * `src/lib/__tests__/utils.test.ts`; what this file adds is that the card calls
 * the smart formatter at all rather than the plain `formatRideDate` it drew
 * before, which no formatter test can see.
 *
 * `environment: 'node'`, so `renderToStaticMarkup` gives the markup a browser
 * would have parsed and no layout whatever — the limit `PostcardAction.test.tsx`
 * records. No `next/navigation` mock: this card navigates through `next/link`
 * and reads no router hook.
 */
const ride = (over: Partial<RideListItem> = {}): RideListItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Ardennes loop',
  meeting_point: 'Amsterdam Centraal',
  // Fixed rather than relative to `Date.now()`: a departure two years in the
  // past can only fall in the plain-date band, so these assertions do not move
  // with the clock the way a `Tomorrow` fixture would.
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

describe('RideCard — the distance clause', () => {
  it('draws nothing at all when no distance was attached', () => {
    const html = renderToStaticMarkup(<RideCard ride={ride()} />)

    expect(html).toContain('Amsterdam Centraal')
    expect(html).not.toContain('km away')
    // The separator dot belongs to the clause, so it must not survive it — an
    // orphan 3px dot after the address is what a naive conditional leaves.
    expect(html.split('Amsterdam Centraal')[1]).not.toContain('rounded-full bg-muted')
  })

  it('draws it when one was', () => {
    expect(renderToStaticMarkup(<RideCard ride={ride({ distance_km: 11.6 })} />)).toContain(
      '12 km away'
    )
  })

  it('never renders a distance of zero as a number', () => {
    expect(renderToStaticMarkup(<RideCard ride={ride({ distance_km: 0.2 })} />)).toContain(
      'Under 1 km away'
    )
  })

  // The place gives up characters, the distance does not. Asserted as the class
  // pair on the two spans, because there is no layout in a node render to
  // measure — same instrument, and same limit, as `PostcardCard`'s geometry.
  it('truncates the meeting point rather than the distance', () => {
    const html = renderToStaticMarkup(<RideCard ride={ride({ distance_km: 12 })} />)
    const line = html.slice(html.indexOf('Amsterdam Centraal') - 200)

    expect(line).toContain('min-w-0 truncate')
    expect(line).toMatch(/shrink-0"[^<]*>12 km away/)
  })
})

describe('RideCard — the day', () => {
  it('draws the smart day rather than the plain card date', () => {
    // Two years in the past, so the band is the fallback and the string is
    // `formatRideDate`'s own — which is what makes the *upcoming* case below
    // evidence that the smart formatter is wired in rather than a coincidence.
    expect(renderToStaticMarkup(<RideCard ride={ride()} />)).toContain('SAT, 16 NOV')

    const soon = new Date()
    soon.setDate(soon.getDate() + 1)
    // `Tomorrow` is a string `formatRideDate` cannot produce at any clock, so
    // this fails the moment the card is pointed back at it.
    expect(
      renderToStaticMarkup(<RideCard ride={ride({ departure_at: soon.toISOString() })} />)
    ).toMatch(/Today|Tomorrow/)
  })
})
