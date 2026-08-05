import { describe, expect, it } from 'vitest'
import {
  RIDE_AVATAR_LIMIT,
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

  it('tolerates a null crew embed', () => {
    const item = toRideListItem(row({ riders: null }), ORGANIZER.id, NOW)

    expect(item.riders_count).toBe(1)
    expect(item.attendance).toBe('going')
  })
})

const crewMember = (n: number) => ({ user_id: `rider-${n}`, profile: rider(n) })

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
