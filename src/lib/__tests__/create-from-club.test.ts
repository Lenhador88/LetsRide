import { describe, expect, it } from 'vitest'
import { seedClubId } from '@/lib/clubs/seed-club-id'
import { createRideHeaderTitle } from '@/lib/rides/create-ride-header-title'
import { seedRideId } from '@/lib/rides/seed-ride-id'
import { CREATE_CLUB_PARAM, CREATE_RIDE_PARAM, backFromCreateScreen, routes } from '@/lib/routes'

/**
 * The two pure halves of "creating from a club stays in the club" (PD-283) —
 * what the composer's `<select>` starts on, and where its back control goes.
 *
 * Both are tested for the same reason `resolveComboboxKey` and `guard.ts` are:
 * the surrounding component cannot be rendered by a node-environment suite, and
 * the part that can be got wrong is a decision rather than a layout.
 *
 * The link builders are asserted against `backFromCreateScreen` rather than
 * against literals wherever a round trip is what matters, so a renamed
 * parameter fails here instead of silently sending every rider Home.
 */
const CLUB = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-8888-4777-8666-555555555555'
const RIDE = '22222222-3333-4444-8555-666666666666'

describe('seedClubId', () => {
  const clubs = [{ id: CLUB }, { id: OTHER }]

  it('seeds a club the rider is actually in', () => {
    expect(seedClubId(clubs, CLUB)).toBe(CLUB)
  })

  it('falls back to no club when the id is not one of theirs', () => {
    // The failure this prevents: a controlled `<select>` whose value matches no
    // option renders as the FIRST option while reporting the unmatched value —
    // so the composer would show one audience and submit another.
    expect(seedClubId(clubs, '00000000-0000-4000-8000-000000000000')).toBe('')
  })

  it('falls back when the parameter is absent, empty or null', () => {
    expect(seedClubId(clubs, null)).toBe('')
    expect(seedClubId(clubs, undefined)).toBe('')
    expect(seedClubId(clubs, '')).toBe('')
  })

  it('falls back when the rider is in no clubs at all', () => {
    expect(seedClubId([], CLUB)).toBe('')
  })
})

describe('seedRideId', () => {
  const rides = [{ id: RIDE }, { id: OTHER }]

  it('seeds a ride the rider is actually crew of', () => {
    expect(seedRideId(rides, RIDE)).toBe(RIDE)
  })

  it('falls back to no ride when the id is not one of theirs', () => {
    // Same failure `seedClubId` prevents: a controlled `<select>` whose value
    // matches no option renders as the FIRST option while reporting the
    // unmatched value, so the composer would show one ride and submit another.
    expect(seedRideId(rides, '00000000-0000-4000-8000-000000000000')).toBe('')
  })

  it('falls back when the parameter is absent, empty or null', () => {
    expect(seedRideId(rides, null)).toBe('')
    expect(seedRideId(rides, undefined)).toBe('')
    expect(seedRideId(rides, '')).toBe('')
  })

  it('falls back when the rider is crew of no rides at all', () => {
    expect(seedRideId([], RIDE)).toBe('')
  })
})

describe('backFromCreateScreen', () => {
  it('returns the club when the id is a well-formed uuid', () => {
    expect(backFromCreateScreen({ club: CLUB }, '/rides')).toBe(routes.club(CLUB))
  })

  it('returns the ride when the id is a well-formed uuid', () => {
    expect(backFromCreateScreen({ ride: RIDE }, '/postcards')).toBe(routes.ride(RIDE))
  })

  it('prefers the ride when both are present (PD-256)', () => {
    // Only the postcard composer can ever carry both — the ride's own club is
    // a prefill, not a second "opened from".
    expect(backFromCreateScreen({ club: CLUB, ride: RIDE }, '/postcards')).toBe(routes.ride(RIDE))
  })

  it('falls back to the screen’s own tab root when there is neither', () => {
    expect(backFromCreateScreen({ club: null }, '/rides')).toBe('/rides')
    expect(backFromCreateScreen({ club: undefined }, '/postcards')).toBe('/postcards')
    expect(backFromCreateScreen({ club: '' }, '/postcards')).toBe('/postcards')
    expect(backFromCreateScreen({}, '/postcards')).toBe('/postcards')
  })

  it('falls back rather than building a link to a 404', () => {
    // A malformed id would produce `/clubs/detail?id=not-a-uuid`, whose read
    // answers null and whose page calls `notFound()`. A blunt back destination
    // beats a back button that lands on Not Found.
    expect(backFromCreateScreen({ club: 'not-a-uuid' }, '/rides')).toBe('/rides')
    expect(backFromCreateScreen({ club: '../../etc/passwd' }, '/rides')).toBe('/rides')
    expect(backFromCreateScreen({ club: 'https://example.com' }, '/rides')).toBe('/rides')
    expect(backFromCreateScreen({ ride: 'not-a-uuid' }, '/postcards')).toBe('/postcards')
  })

  it('can only ever produce a club or ride route, whatever it is handed', () => {
    // The property that makes this safe without `back-navigation.ts`'s
    // BACK_ORIGINS allowlist: the input is an id, not a path, so there is no
    // open redirect to close. Every accepted value goes through routes.club
    // or routes.ride.
    for (const candidate of [CLUB, OTHER]) {
      expect(backFromCreateScreen({ club: candidate }, '/rides')).toBe(routes.club(candidate))
    }
  })
})

describe('the club-carrying links', () => {
  it('round-trip through the parameter the create screens read', () => {
    const rideLink = routes.newRideInClub(CLUB)
    const postcardLink = routes.newPostcardInClub(CLUB)

    expect(rideLink).toBe(`/rides/new?${CREATE_CLUB_PARAM}=${CLUB}`)
    expect(postcardLink).toBe(`/postcards/new?${CREATE_CLUB_PARAM}=${CLUB}`)

    for (const link of [rideLink, postcardLink]) {
      const carried = new URLSearchParams(link.split('?')[1]).get(CREATE_CLUB_PARAM)
      expect(carried).toBe(CLUB)
      expect(backFromCreateScreen({ club: carried }, '/rides')).toBe(routes.club(CLUB))
    }
  })
})

describe('createRideHeaderTitle — the /rides/new header (PD-383)', () => {
  const clubs = [{ id: CLUB, name: 'Ridge Riders' }, { id: OTHER, name: 'Coast Crew' }]

  it('is the plain title with no club param, even before clubs.data resolves', () => {
    expect(createRideHeaderTitle(null, undefined)).toBe('Create ride')
    expect(createRideHeaderTitle(null, clubs)).toBe('Create ride')
  })

  it('waits (undefined) for a club-scoped entry until clubs.data resolves', () => {
    // Header draws its own skeleton for `undefined` — this must never fall
    // back to the plain title first and then swap to the named one, which
    // would flash the wrong heading for one frame.
    expect(createRideHeaderTitle(CLUB, undefined)).toBeUndefined()
  })

  it('names the club once it resolves', () => {
    expect(createRideHeaderTitle(CLUB, clubs)).toBe('Create ride in Ridge Riders')
  })

  it('falls back to the plain title for an id that is not one of the rider’s own clubs', () => {
    // The same fallback `seedClubId` uses — a rider-supplied id authorizes
    // nothing, and the heading must not claim a club the picker itself would
    // not have shown.
    const strangerClub = '00000000-0000-4000-8000-000000000000'
    expect(createRideHeaderTitle(strangerClub, clubs)).toBe('Create ride')
  })

  it('falls back to the plain title when the rider is in no clubs at all', () => {
    expect(createRideHeaderTitle(CLUB, [])).toBe('Create ride')
  })
})

describe('the ride-carrying link (PD-256)', () => {
  it('round-trips through the parameter the postcard composer reads', () => {
    const postcardLink = routes.newPostcardInRide(RIDE)

    expect(postcardLink).toBe(`/postcards/new?${CREATE_RIDE_PARAM}=${RIDE}`)

    const carried = new URLSearchParams(postcardLink.split('?')[1]).get(CREATE_RIDE_PARAM)
    expect(carried).toBe(RIDE)
    expect(backFromCreateScreen({ ride: carried }, '/postcards')).toBe(routes.ride(RIDE))
  })
})
