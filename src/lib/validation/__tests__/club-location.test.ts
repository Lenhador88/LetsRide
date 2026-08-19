import { describe, expect, it } from 'vitest'
import {
  CLUB_LOCATION_NAME_MAX,
  CLUB_LOCATION_PLACE_ID_MAX,
  clubLocationSchema,
  readClubLocation,
} from '@/lib/validation/clubs'

/**
 * The club-location half of `clubSchema` (PD-259, `066`).
 *
 * These cover the MESSAGE layer. The GUARANTEE is `clubs_location_coupling` and
 * the two length CHECKs, asserted in `supabase/tests/rls_test.sql` §066 — a
 * rider drives the browser, so nothing here is load-bearing on its own. What
 * these do prove is that the two agree, which is the failure that produces a
 * raw 23514 in front of a rider instead of a sentence.
 */
function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

const complete = {
  location_name: 'Utrecht',
  location_place_id: '08f196a0e0a2c8f0039e5f2a7f6d1c3b',
  latitude: '52.0907',
  longitude: '5.1214',
}

describe('readClubLocation', () => {
  it('reads all four fields into one object', () => {
    expect(readClubLocation(form(complete))).toEqual({
      location_name: 'Utrecht',
      location_place_id: '08f196a0e0a2c8f0039e5f2a7f6d1c3b',
      latitude: 52.0907,
      longitude: 5.1214,
    })
  })

  it('answers null for an empty form — no location is the normal state', () => {
    expect(readClubLocation(new FormData())).toBeNull()
    expect(
      readClubLocation(
        form({ location_name: '', location_place_id: '', latitude: '', longitude: '' })
      )
    ).toBeNull()
  })

  it.each([
    ['location_name', 'the name'],
    ['location_place_id', 'the place id'],
    ['latitude', 'the latitude'],
    ['longitude', 'the longitude'],
  ])('answers null when %s is missing, rather than a partial object', (missing) => {
    const partial = { ...complete, [missing]: '' }
    expect(readClubLocation(form(partial))).toBeNull()
  })

  it('does NOT read an empty coordinate as the Gulf of Guinea', () => {
    // `Number('')` is 0, and 0/0 is a real point in the Atlantic. The emptiness
    // test is on the string for exactly this reason — the whole function exists
    // rather than a `z.coerce.number()` because of this case.
    const cleared = { ...complete, latitude: '', longitude: '' }
    expect(readClubLocation(form(cleared))).toBeNull()
  })

  it('answers null for a coordinate that is not a number at all', () => {
    expect(readClubLocation(form({ ...complete, latitude: 'north' }))).toBeNull()
    expect(readClubLocation(form({ ...complete, longitude: 'Infinity' }))).toBeNull()
  })

  it('trims, so a field of spaces is empty rather than a location named " "', () => {
    expect(readClubLocation(form({ ...complete, location_name: '   ' }))).toBeNull()
  })

  it('keeps a real negative coordinate, which the emptiness test must not eat', () => {
    const southWest = { ...complete, latitude: '-33.9249', longitude: '-18.4241' }
    expect(readClubLocation(form(southWest))).toMatchObject({
      latitude: -33.9249,
      longitude: -18.4241,
    })
  })

  it('keeps a genuine zero coordinate', () => {
    // 0,0 is in the ocean, but the schema is not a geographer: what matters is
    // that a real 0 survives while an empty string does not.
    expect(readClubLocation(form({ ...complete, latitude: '0', longitude: '0' }))).toMatchObject({
      latitude: 0,
      longitude: 0,
    })
  })
})

describe('clubLocationSchema', () => {
  it('accepts a complete location', () => {
    expect(clubLocationSchema.safeParse(readClubLocation(form(complete))).success).toBe(true)
  })

  it('accepts null — the field is optional at create and clearable afterwards', () => {
    expect(clubLocationSchema.safeParse(null).success).toBe(true)
  })

  it.each([
    ['latitude', 91],
    ['latitude', -91],
    ['longitude', 181],
    ['longitude', -181],
  ])('refuses an out-of-range %s of %s, matching the CHECK', (field, value) => {
    const parsed = clubLocationSchema.safeParse({
      location_name: 'Nowhere',
      location_place_id: 'x',
      latitude: 52,
      longitude: 5,
      [field]: value,
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses a name past the length the database refuses', () => {
    const parsed = clubLocationSchema.safeParse({
      ...readClubLocation(form(complete))!,
      location_name: 'x'.repeat(CLUB_LOCATION_NAME_MAX + 1),
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses a place id past the length the database refuses', () => {
    const parsed = clubLocationSchema.safeParse({
      ...readClubLocation(form(complete))!,
      location_place_id: 'x'.repeat(CLUB_LOCATION_PLACE_ID_MAX + 1),
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a name and an id AT the bound, so the two rules agree exactly', () => {
    // Off-by-one in either direction is a raw 23514 in front of a rider, or a
    // message for a write the database would have taken.
    const parsed = clubLocationSchema.safeParse({
      ...readClubLocation(form(complete))!,
      location_name: 'x'.repeat(CLUB_LOCATION_NAME_MAX),
      location_place_id: 'x'.repeat(CLUB_LOCATION_PLACE_ID_MAX),
    })
    expect(parsed.success).toBe(true)
  })
})
