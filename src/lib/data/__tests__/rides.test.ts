import { describe, expect, it } from 'vitest'
import {
  RIDE_AVATAR_LIMIT,
  isRideCrew,
  mergeMine,
  toRideListItem,
  withOrganizer,
  type RideRow,
} from '@/lib/data/rides'
import type { PublicProfile } from '@/types'

const ORGANIZER: PublicProfile = {
  id: 'organizer-1',
  username: 'duskrider',
  avatar_url: null,
  avatar_path: null,
  bike_model: 'CB500X',
}

const rider = (n: number): PublicProfile => ({
  id: `rider-${n}`,
  username: `rider${n}`,
  avatar_url: null,
  avatar_path: null,
  bike_model: null,
})

const NOW = new Date('2026-08-04T12:00:00Z').getTime()

function row(overrides: Partial<RideRow> = {}): RideRow {
  return {
    id: 'ride-1',
    title: 'Weekend cruise',
    meeting_point: 'Leiderdorp',
    departure_at: '2026-08-16T10:00:00Z',
    organizer_id: ORGANIZER.id,
    // NULL on every ride in both databases until the render function ships.
    map_card_path: null,
    organizer: ORGANIZER,
    club: null,
    riders: [],
    ...overrides,
  }
}

describe('toRideListItem', () => {
  it('leads the avatar row with the organizer', () => {
    const item = toRideListItem(
      row({ riders: [{ user_id: 'rider-1', status: 'going', profile: rider(1) }] }),
      undefined,
      NOW,
    )

    expect(item.riders.map((r) => r.id)).toEqual(['organizer-1', 'rider-1'])
  })

  it('does not draw the organizer twice when they also hold a member row', () => {
    const item = toRideListItem(
      row({
        riders: [
          { user_id: ORGANIZER.id, status: 'going', profile: ORGANIZER },
          { user_id: 'rider-1', status: 'maybe', profile: rider(1) },
        ],
      }),
      undefined,
      NOW,
    )

    expect(item.riders.map((r) => r.id)).toEqual(['organizer-1', 'rider-1'])
    expect(item.riders_count).toBe(2)
  })

  it('counts everyone on the ride, not just the faces it shows', () => {
    const crew = Array.from({ length: 16 }, (_, i) => ({
      user_id: `rider-${i}`,
      status: 'going' as const,
      profile: rider(i),
    }))

    const item = toRideListItem(row({ riders: crew }), undefined, NOW)

    // The design's own example: five avatars and "+12" — seventeen riders.
    expect(item.riders).toHaveLength(RIDE_AVATAR_LIMIT)
    expect(item.riders_count).toBe(17)
    expect(item.riders_count - item.riders.length).toBe(12)
  })

  it('still counts the organizer when their profile is unreadable', () => {
    const item = toRideListItem(row({ organizer: null }), undefined, NOW)

    expect(item.riders).toHaveLength(0)
    expect(item.riders_count).toBe(1)
  })

  it("reads the viewer's own RSVP for the pill", () => {
    const item = toRideListItem(
      row({ riders: [{ user_id: 'rider-1', status: 'maybe', profile: rider(1) }] }),
      'rider-1',
      NOW,
    )

    expect(item.attendance).toBe('maybe')
  })

  it('draws no pill for a rider who has not responded', () => {
    const item = toRideListItem(row(), 'rider-9', NOW)

    expect(item.attendance).toBeNull()
  })

  it('treats an organizer with no member row as going', () => {
    const item = toRideListItem(row(), ORGANIZER.id, NOW)

    expect(item.attendance).toBe('going')
  })

  it("lets an organizer's explicit row override that default", () => {
    const item = toRideListItem(
      row({ riders: [{ user_id: ORGANIZER.id, status: 'maybe', profile: ORGANIZER }] }),
      ORGANIZER.id,
      NOW,
    )

    expect(item.attendance).toBe('maybe')
  })

  it('draws no pill at all for a signed-out read', () => {
    const item = toRideListItem(row(), undefined, NOW)

    expect(item.attendance).toBeNull()
  })

  it('flags upcoming against the clock it is given, not the wall clock', () => {
    expect(toRideListItem(row(), undefined, NOW).is_upcoming).toBe(true)
    expect(
      toRideListItem(row({ departure_at: '2026-07-01T10:00:00Z' }), undefined, NOW).is_upcoming,
    ).toBe(false)
  })

  it('counts a ride departing this instant as upcoming', () => {
    const item = toRideListItem(row({ departure_at: new Date(NOW).toISOString() }), undefined, NOW)

    expect(item.is_upcoming).toBe(true)
  })

  it('keeps a ride that departed earlier today on the upcoming side', () => {
    // The cutoff it is handed is the start of the day, not the clock, so a
    // ride at 15:00 still reads as upcoming to a rider looking at 23:00 —
    // which is what keeps the pill and the "Previous rides" header agreeing.
    const dayStart = new Date('2026-08-15T22:00:00.000Z').getTime()
    expect(
      toRideListItem(row({ departure_at: '2026-08-16T13:00:00Z' }), undefined, dayStart).is_upcoming
    ).toBe(true)
    expect(
      toRideListItem(row({ departure_at: '2026-08-15T13:00:00Z' }), undefined, dayStart).is_upcoming
    ).toBe(false)
  })

  it('tolerates a null crew embed', () => {
    const item = toRideListItem(row({ riders: null }), ORGANIZER.id, NOW)

    expect(item.riders_count).toBe(1)
    expect(item.attendance).toBe('going')
  })

  it('carries no tile URL for a ride with no tile, which is every ride today', () => {
    // `RideCard` reads exactly this field to decide between the tile and the
    // pin container it has always drawn, so null here is what keeps the
    // fallback the universal rendering.
    expect(toRideListItem(row(), undefined, NOW).map_card_url).toBeNull()
  })

  it('copies the URL the signing pass wrote onto the row, rather than the path', () => {
    const item = toRideListItem(
      row({ map_card_path: 'ride-maps/o1/a.jpg', map_card_url: 'https://signed.test/a.jpg' }),
      undefined,
      NOW,
    )

    expect(item.map_card_url).toBe('https://signed.test/a.jpg')
  })

  it('reads a path that never got signed as no tile', () => {
    // A tile this viewer's Storage policy refuses signs to null, and the card
    // must draw the ordinary fallback rather than a broken image — the path
    // itself is never something a component can render.
    const item = toRideListItem(row({ map_card_path: 'ride-maps/o1/a.jpg' }), undefined, NOW)

    expect(item.map_card_url).toBeNull()
  })
})

const crewMember = (n: number) => ({ user_id: `rider-${n}`, profile: rider(n) })

/**
 * The merge behind the `mine` filter's two arms. Its correctness argument lives
 * on the function; these are the four properties that argument rests on, and
 * the last one is the one a naive implementation gets wrong.
 */
describe('mergeMine', () => {
  const at = (id: string, departure_at: string) => row({ id, departure_at })

  it('is one ride for an organizer who also holds a member row', () => {
    // The two arms overlap by construction — organising a ride and RSVPing to
    // it are not exclusive — and the card would otherwise draw twice.
    const merged = mergeMine(
      [at('ride-1', '2026-08-16T10:00:00Z'), at('ride-1', '2026-08-16T10:00:00Z')],
      { from: '2026-08-04T22:00:00.000Z' },
      10
    )
    expect(merged.map((r) => r.id)).toEqual(['ride-1'])
  })

  it('sorts an upcoming window soonest first', () => {
    const merged = mergeMine(
      [at('c', '2026-08-20T10:00:00Z'), at('a', '2026-08-16T10:00:00Z'), at('b', '2026-08-18T10:00:00Z')],
      { from: '2026-08-04T22:00:00.000Z' },
      10
    )
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts a previous window newest first', () => {
    // The opposite direction, and the reason the window carries it: ascending
    // here would show the oldest rides the section is allowed to carry and
    // truncate last weekend's.
    const merged = mergeMine(
      [at('a', '2026-07-01T10:00:00Z'), at('c', '2026-08-01T10:00:00Z'), at('b', '2026-07-15T10:00:00Z')],
      { before: '2026-08-04T22:00:00.000Z' },
      10
    )
    expect(merged.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('takes the true first N of the union, not the first N of one arm', () => {
    // Each arm arrives ordered and bounded, so the merge has to re-sort before
    // it slices — otherwise a rider whose organised rides all sort later than
    // their joined ones loses the joined ones at the cut.
    const merged = mergeMine(
      [at('organised', '2026-08-30T10:00:00Z'), at('joined', '2026-08-05T10:00:00Z')],
      { from: '2026-08-04T22:00:00.000Z' },
      1
    )
    expect(merged.map((r) => r.id)).toEqual(['joined'])
  })
})

/**
 * The client's mirror of `private.is_ride_crew` (034), which gates both entry
 * points to the ride chat. Asserted rather than assumed because it restates a
 * database predicate: if 034 narrows, one of these cases starts failing, which
 * is the signal that three screens need looking at.
 */
describe('isRideCrew', () => {
  it('is true for the organizer with no RSVP row of their own', () => {
    expect(isRideCrew(true, null)).toBe(true)
  })

  it('is true for maybe, not only going — 034 gives the chat to both', () => {
    expect(isRideCrew(false, 'maybe')).toBe(true)
    expect(isRideCrew(false, 'going')).toBe(true)
  })

  it('is false for a rider who has not answered', () => {
    expect(isRideCrew(false, null)).toBe(false)
  })
})

describe('withOrganizer', () => {
  it('puts the organizer at the head of going and marks them host', () => {
    const crew = withOrganizer(
      { going: [crewMember(1)], maybe: [] },
      ORGANIZER.id,
      ORGANIZER
    )

    expect(crew.going.map((m) => m.user_id)).toEqual([ORGANIZER.id, 'rider-1'])
    expect(crew.going[0].is_host).toBe(true)
    expect(crew.going[1].is_host).toBeUndefined()
  })

  it('adds the organizer even when they hold no ride_members row', () => {
    // The case the whole function exists for: organising a ride does not
    // create an RSVP row, so reading the roster alone drops the host.
    const crew = withOrganizer({ going: [], maybe: [] }, ORGANIZER.id, ORGANIZER)

    expect(crew.going).toHaveLength(1)
    expect(crew.going[0]).toMatchObject({ user_id: ORGANIZER.id, is_host: true })
  })

  it('does not draw the organizer twice when they also RSVP’d going', () => {
    const crew = withOrganizer(
      {
        going: [{ user_id: ORGANIZER.id, profile: ORGANIZER }, crewMember(1)],
        maybe: [],
      },
      ORGANIZER.id,
      ORGANIZER
    )

    expect(crew.going.filter((m) => m.user_id === ORGANIZER.id)).toHaveLength(1)
    expect(crew.going.map((m) => m.user_id)).toEqual([ORGANIZER.id, 'rider-1'])
  })

  it('promotes an organizer who RSVP’d maybe into going, leaving no duplicate', () => {
    // The design has one host row and it sits in the first section, so a
    // "maybe" from the organizer must not strand them under May be going.
    const crew = withOrganizer(
      { going: [], maybe: [{ user_id: ORGANIZER.id, profile: ORGANIZER }, crewMember(2)] },
      ORGANIZER.id,
      ORGANIZER
    )

    expect(crew.going.map((m) => m.user_id)).toEqual([ORGANIZER.id])
    expect(crew.maybe.map((m) => m.user_id)).toEqual(['rider-2'])
  })

  it('falls back to the roster profile when the organizer profile is unreadable', () => {
    // getRide embeds the organizer under RLS; a blocked or half-onboarded
    // rider comes back null there while their ride_members row still carries
    // a profile. Preferring null would blank a name the page can render.
    const crew = withOrganizer(
      { going: [{ user_id: ORGANIZER.id, profile: ORGANIZER }], maybe: [] },
      ORGANIZER.id,
      null
    )

    expect(crew.going[0].profile).toEqual(ORGANIZER)
  })

  it('keeps a null profile when nothing can supply one', () => {
    const crew = withOrganizer({ going: [], maybe: [] }, ORGANIZER.id, null)

    expect(crew.going[0]).toMatchObject({ user_id: ORGANIZER.id, profile: null })
  })
})
