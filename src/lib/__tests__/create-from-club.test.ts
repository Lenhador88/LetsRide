import { describe, expect, it } from 'vitest'
import { seedClubId } from '@/lib/clubs/seed-club-id'
import { CREATE_CLUB_PARAM, backFromCreateScreen, routes } from '@/lib/routes'

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

describe('backFromCreateScreen', () => {
  it('returns the club when the id is a well-formed uuid', () => {
    expect(backFromCreateScreen(CLUB, '/rides')).toBe(routes.club(CLUB))
  })

  it('falls back to the screen’s own tab root when there is no club', () => {
    expect(backFromCreateScreen(null, '/rides')).toBe('/rides')
    expect(backFromCreateScreen(undefined, '/postcards')).toBe('/postcards')
    expect(backFromCreateScreen('', '/postcards')).toBe('/postcards')
  })

  it('falls back rather than building a link to a 404', () => {
    // A malformed id would produce `/clubs/detail?id=not-a-uuid`, whose read
    // answers null and whose page calls `notFound()`. A blunt back destination
    // beats a back button that lands on Not Found.
    expect(backFromCreateScreen('not-a-uuid', '/rides')).toBe('/rides')
    expect(backFromCreateScreen('../../etc/passwd', '/rides')).toBe('/rides')
    expect(backFromCreateScreen('https://example.com', '/rides')).toBe('/rides')
  })

  it('can only ever produce a club route, whatever it is handed', () => {
    // The property that makes this safe without `back-navigation.ts`'s
    // BACK_ORIGINS allowlist: the input is an id, not a path, so there is no
    // open redirect to close. Every accepted value goes through routes.club.
    for (const candidate of [CLUB, OTHER]) {
      expect(backFromCreateScreen(candidate, '/rides')).toBe(routes.club(candidate))
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
      expect(backFromCreateScreen(carried, '/rides')).toBe(routes.club(CLUB))
    }
  })
})
