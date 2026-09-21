import { describe, expect, it } from 'vitest'
import { clubCreateSchema, clubSchema, readClubLocation } from '@/lib/validation/clubs'

/**
 * The create gate — PD-446. A club must say where it is based, and only on the
 * way in.
 *
 * **What this pins is an asymmetry, which is the whole reason it is a file of
 * its own.** `clubSchema` and `clubCreateSchema` are built from one shared field
 * body and differ in exactly one member, so every assertion here is about that
 * member and about the two paths staying different. The trap it exists for:
 * "make the location required" collapsing both schemas into one, which reads as
 * a tidy-up and silently makes a club that predates this gate uneditable by its
 * owner until they answer a question about it.
 *
 * **Nothing in Postgres enforces any of this.** `066`'s
 * `clubs_location_coupling` requires the four columns to move together or all
 * stay null; it says nothing about whether they may be null, and no migration
 * in this change says otherwise. So this is a gate on one screen rather than a
 * rule about what the column may hold, and a reader must not narrow a type on
 * the strength of it — measured 2026-09-08, DEV 15/15 and PROD 2/2 clubs carry
 * a location, so the edit path has **no live row behind it** and exists purely
 * as permanent contract.
 */
const complete = {
  location_name: 'Utrecht',
  location_place_id: '08f196a0e0a2c8f0039e5f2a7f6d1c3b',
  latitude: 52.0907,
  longitude: 5.1214,
}

const club = {
  name: 'Ochtend Rijders',
  description: null,
  is_public: true,
  avatar_path: null,
  cover_image_path: null,
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

describe('the create gate requires a location', () => {
  it('refuses a club with no location', () => {
    const parsed = clubCreateSchema.safeParse({ ...club, location: null })
    expect(parsed.success).toBe(false)
  })

  it('says so in a sentence a rider can act on, not in Zod type prose', () => {
    // The failure this replaces: unwrapping the nullable and parsing `null`
    // answers "Invalid input: expected object, received null" — a sentence
    // about JavaScript, rendered by `createClub` straight into the form's
    // error region. Assert the message, not merely the refusal.
    const parsed = clubCreateSchema.safeParse({ ...club, location: null })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0].message).toBe('Pick where your club is based.')
    expect(parsed.error.issues[0].message).not.toMatch(/expected|received|Invalid input/i)
  })

  it('names the field it refused, so the form can move focus to it', () => {
    // `CreateClubForm`'s error effect switches on `issues[0].path[0]`. A
    // refinement that reported an empty path would leave focus where it was
    // with nothing on screen explaining why.
    const parsed = clubCreateSchema.safeParse({ ...club, location: null })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0].path[0]).toBe('location')
  })

  it('accepts a complete pick', () => {
    expect(clubCreateSchema.safeParse({ ...club, location: complete }).success).toBe(true)
  })

  it('still refuses a malformed pick with the inner message, not the new one', () => {
    // The refinement must not shadow `clubLocationSchema`'s own four messages:
    // a pick whose name is empty is a different failure from no pick at all.
    const parsed = clubCreateSchema.safeParse({
      ...club,
      location: { ...complete, location_name: '' },
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0].message).toBe('Pick a place from the list.')
  })
})

describe('the edit path is untouched — the trap this file exists for', () => {
  it('clubSchema still accepts a club with no location', () => {
    // The one assertion that fails the moment somebody "makes the location
    // required" by editing the shared schema instead of the create one. A club
    // stored before this gate must stay editable by its owner without being
    // made to supply a location first.
    expect(clubSchema.safeParse({ ...club, location: null }).success).toBe(true)
  })

  it('clubSchema still accepts a club that DOES carry one', () => {
    expect(clubSchema.safeParse({ ...club, location: complete }).success).toBe(true)
  })

  it('the two schemas agree about every field except the location', () => {
    // Both are built from one field body, and this is what says so. A copied
    // field list that drifted by a `.max()` would refuse different values on
    // the two paths for the same column, with nothing failing anywhere.
    const tooLong = { ...club, name: 'x'.repeat(500), location: complete }
    expect(clubSchema.safeParse(tooLong).success).toBe(false)
    expect(clubCreateSchema.safeParse(tooLong).success).toBe(false)

    const fine = { ...club, location: complete }
    expect(clubSchema.safeParse(fine).success).toBe(true)
    expect(clubCreateSchema.safeParse(fine).success).toBe(true)
  })
})

describe('what reaches the gate from the form', () => {
  it('refuses a partial hidden-field set, because it arrives as null', () => {
    // Three of four. `readClubLocation` reads that as "no location" rather than
    // as a partial object — the picker writes all four or clears all four — and
    // the gate then refuses it. Both halves matter: a partial set that parsed
    // would be refused by `clubs_location_coupling` as a raw 23514 instead.
    const partial = form({
      location_name: 'Utrecht',
      location_place_id: '08f196a0e0a2c8f0039e5f2a7f6d1c3b',
      latitude: '52.0907',
    })
    expect(readClubLocation(partial)).toBeNull()
    expect(clubCreateSchema.safeParse({ ...club, location: readClubLocation(partial) }).success).toBe(
      false
    )
  })

  it('accepts a pick at latitude 0 and longitude 0', () => {
    // `Number('')` is `0`, a real coordinate in the Gulf of Guinea, so the
    // emptiness test in `readClubLocation` is on the STRING. A gate rewritten
    // as a truthiness check on the parsed numbers passes every other test in
    // this file and refuses a rider standing on the equator.
    const nullIsland = form({
      location_name: 'Null Island',
      location_place_id: 'nullisland',
      latitude: '0',
      longitude: '0',
    })
    expect(readClubLocation(nullIsland)).toEqual({
      location_name: 'Null Island',
      location_place_id: 'nullisland',
      latitude: 0,
      longitude: 0,
    })
    expect(
      clubCreateSchema.safeParse({ ...club, location: readClubLocation(nullIsland) }).success
    ).toBe(true)
  })

  it('refuses an empty form, which is what an untouched field posts', () => {
    const empty = form({
      location_name: '',
      location_place_id: '',
      latitude: '',
      longitude: '',
    })
    expect(readClubLocation(empty)).toBeNull()
    expect(clubCreateSchema.safeParse({ ...club, location: readClubLocation(empty) }).success).toBe(
      false
    )
  })
})
