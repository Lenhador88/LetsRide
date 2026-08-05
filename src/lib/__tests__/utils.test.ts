import { describe, expect, it } from 'vitest'
import {
  formatPostcardDate,
  formatRelativeTime,
  formatRideDate,
  formatRideDateLong,
  formatRideTime,
  wallClockToUtc,
  getInitials,
  googleMapsDirectionsUrl,
} from '@/lib/utils'

// TZ is pinned to UTC in vitest.config.ts, and for these assertions that pin is
// now inert: `formatRideDate` carries its own `timeZone`, so it renders the same
// string on any runner. The pin still matters for `formatPostcardDate` and
// `formatRelativeTime`, which have none.
//
// An earlier version of this comment said the pin "is what makes them
// reproducible", which was true when the helpers took the process zone and is
// exactly how the UTC bug hid here — see the timezone block further down.
describe('formatRideDate', () => {
  it('reads as the design draws it — uppercase, weekday first, no year', () => {
    expect(formatRideDate('2024-11-16T10:00:00Z')).toBe('SAT, 16 NOV')
    expect(formatRideDate('2024-11-17T13:30:00Z')).toBe('SUN, 17 NOV')
  })

  it('puts the day before the month, as en-GB does', () => {
    // For a European rider app. An en-US ordering would read "NOV 16".
    expect(formatRideDate('2026-01-02T09:00:00Z')).toBe('FRI, 2 JAN')
  })
})

describe('formatRideDateLong', () => {
  it('reads as the ride detail draws it — long weekday, sentence case, no year', () => {
    expect(formatRideDateLong('2024-11-16T10:00:00Z')).toBe('Saturday, 16 Nov')
    expect(formatRideDateLong('2026-01-02T09:00:00Z')).toBe('Friday, 2 Jan')
  })

  it('differs from the list card only in weekday length and case', () => {
    // The two are separate functions rather than one with a flag, so this is
    // the assertion that keeps them from quietly converging.
    expect(formatRideDate('2024-11-16T10:00:00Z')).toBe('SAT, 16 NOV')
    expect(formatRideDateLong('2024-11-16T10:00:00Z')).toBe('Saturday, 16 Nov')
  })

  it('keeps the comma after the weekday that en-GB omits on its own', () => {
    expect(formatRideDateLong('2024-11-16T10:00:00Z')).toContain(', ')
  })
})

describe('formatRideTime', () => {
  it('is a 24-hour clock, zero-padded', () => {
    // CET in November, so these are the UTC instants plus one hour.
    expect(formatRideTime('2024-11-16T10:00:00Z')).toBe('11:00')
    expect(formatRideTime('2024-11-17T13:30:00Z')).toBe('14:30')
    expect(formatRideTime('2024-11-17T08:05:00Z')).toBe('09:05')
  })

  it('does not roll midnight over to 24:00', () => {
    expect(formatRideTime('2024-11-16T23:00:00Z')).toBe('00:00')
  })
})

/**
 * The bug these cover: every `formatRide*` helper runs in a **server**
 * component, so before `APP_TIME_ZONE` they rendered in the server's zone —
 * UTC on Vercel — and drew a 20:00 ride as 18:00 all summer.
 *
 * `vitest.config.ts` pins `TZ=UTC`, which is exactly the environment that hid
 * it: the assertions above agreed with production precisely because both were
 * wrong in the same direction. So these do not merely restate the expected
 * strings — they assert the offset is applied, which UTC formatting cannot fake.
 */
describe('ride times are Amsterdam wall clock, not the server’s', () => {
  it('applies the +2 summer offset (CEST)', () => {
    expect(formatRideTime('2024-07-16T10:00:00Z')).toBe('12:00')
  })

  it('applies the +1 winter offset (CET), so DST is handled rather than fixed', () => {
    expect(formatRideTime('2024-11-16T10:00:00Z')).toBe('11:00')
  })

  it('rolls the date with the time, so the two helpers cannot disagree', () => {
    // 23:30 UTC is already the next day in Amsterdam. The date helpers have to
    // move with the clock or a ride reads "Saturday" over "00:30 Sunday".
    const lateUtc = '2024-11-16T23:30:00Z'
    expect(formatRideTime(lateUtc)).toBe('00:30')
    expect(formatRideDate(lateUtc)).toBe('SUN, 17 NOV')
    expect(formatRideDateLong(lateUtc)).toBe('Sunday, 17 Nov')
  })
})

describe('googleMapsDirectionsUrl', () => {
  it('asks for directions, not a highlighted pin', () => {
    // The reported bug: `maps/search/?api=1&query=` drops a marker and stops.
    const url = googleMapsDirectionsUrl('Dam Square, Amsterdam')
    expect(url).toContain('/maps/dir/')
    expect(url).toContain('destination=')
    expect(url).not.toContain('/maps/search/')
    expect(url).not.toContain('query=')
  })

  it('omits an origin, which is what makes Google route from the device', () => {
    expect(googleMapsDirectionsUrl('Dam Square')).not.toContain('origin=')
  })

  it('asks for a road route', () => {
    expect(googleMapsDirectionsUrl('Dam Square')).toContain('travelmode=driving')
  })

  it('encodes an address so it survives the query string', () => {
    expect(googleMapsDirectionsUrl('Dam Square, Amsterdam')).toContain(
      'destination=Dam+Square%2C+Amsterdam'
    )
  })

  it('does not let an ampersand or hash truncate the destination', () => {
    // The hand-built `encodeURIComponent` string this replaced was safe here
    // too, but only by accident of call order — this pins it.
    const url = googleMapsDirectionsUrl('Herengracht 1 & 2 #rear')
    expect(url).toContain('destination=Herengracht+1+%26+2+%23rear')
    expect(url.split('&')).toHaveLength(3)
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-03T12:00:00Z')
  const ago = (seconds: number) =>
    formatRelativeTime(new Date(now.getTime() - seconds * 1000).toISOString(), now)

  it('reads "just now" under a minute, rather than "0 seconds ago"', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(1)).toBe('just now')
    expect(ago(59)).toBe('just now')
  })

  it('switches to minutes at the boundary', () => {
    expect(ago(60)).toBe('1 minute ago')
    expect(ago(59 * 60)).toBe('59 minutes ago')
  })

  it('picks the largest unit that fits', () => {
    expect(ago(60 * 60)).toBe('1 hour ago')
    expect(ago(5 * 60 * 60)).toBe('5 hours ago')
    expect(ago(24 * 60 * 60)).toBe('yesterday')
    expect(ago(3 * 24 * 60 * 60)).toBe('3 days ago')
    expect(ago(7 * 24 * 60 * 60)).toBe('last week')
    expect(ago(30 * 24 * 60 * 60)).toBe('last month')
    expect(ago(365 * 24 * 60 * 60)).toBe('last year')
  })

  it('handles a future timestamp without producing a negative unit', () => {
    const future = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(future, now)).toBe('in 2 hours')
  })

  it('defaults `now` to the current time', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now')
  })
})

describe('getInitials', () => {
  it('returns "R" for null', () => {
    expect(getInitials(null)).toBe('R')
  })

  it('returns "R" for undefined', () => {
    expect(getInitials(undefined)).toBe('R')
  })

  it('returns "R" for an empty string', () => {
    expect(getInitials('')).toBe('R')
  })

  it('returns up to two uppercase initials for a normal username', () => {
    expect(getInitials('ripper')).toBe('R')
  })

  it('uppercases a single-word name to one initial', () => {
    expect(getInitials('gravel')).toBe('G')
  })

  it('takes the first letter of the first two words for a multi-word name', () => {
    expect(getInitials('road warrior')).toBe('RW')
  })

  it('never returns more than two characters, even with three or more words', () => {
    expect(getInitials('road warrior supreme')).toBe('RW')
  })
})

describe('formatPostcardDate', () => {
  it('is day-first, as the design stamps it — "19 Nov 2024", not "Nov 19, 2024"', () => {
    expect(formatPostcardDate('2024-11-19T10:00:00Z')).toBe('19 Nov 2024')
  })

  it('carries no weekday — the stamp has room for three parts', () => {
    // It sits in the corner of a photo, which is what bounds it.
    expect(formatPostcardDate('2025-01-01T10:00:00Z')).toBe('1 Jan 2025')
  })
})

/**
 * The write-side counterpart to the `formatRide*` timezone tests below.
 *
 * These matter for the same reason those do, and the same trap applies:
 * `vitest.config.ts` pins `TZ=UTC`, so a naive `new Date(local)` would look
 * correct in this suite and be two hours wrong on a rider's phone. Every
 * assertion here asserts an *offset*, which UTC parsing cannot fake.
 */
describe('wallClockToUtc', () => {
  it('reads a summer wall clock as CEST (UTC+2)', () => {
    expect(wallClockToUtc('2026-08-16T10:00')).toBe('2026-08-16T08:00:00.000Z')
  })

  it('reads a winter wall clock as CET (UTC+1)', () => {
    expect(wallClockToUtc('2026-11-16T10:00')).toBe('2026-11-16T09:00:00.000Z')
  })

  /**
   * The reason for the second pass. A first guess taken at the naive instant
   * lands on the wrong side of the transition here, and correcting the offset
   * once against that guess is what fixes it.
   */
  it('is correct on both sides of the DST transition', () => {
    // 2026-03-29 02:00 CET -> 03:00 CEST.
    expect(wallClockToUtc('2026-03-29T01:00')).toBe('2026-03-29T00:00:00.000Z')
    expect(wallClockToUtc('2026-03-29T04:00')).toBe('2026-03-29T02:00:00.000Z')
    // 2026-10-25 03:00 CEST -> 02:00 CET.
    expect(wallClockToUtc('2026-10-25T04:00')).toBe('2026-10-25T03:00:00.000Z')
  })

  it('round-trips through the reader it exists to agree with', () => {
    expect(formatRideTime(wallClockToUtc('2026-08-16T20:00'))).toBe('20:00')
    expect(formatRideTime(wallClockToUtc('2026-01-05T07:45'))).toBe('07:45')
  })

  it('accepts a value that already carries seconds', () => {
    expect(wallClockToUtc('2026-08-16T10:00:30')).toBe('2026-08-16T08:00:30.000Z')
  })

  /**
   * The two hours a year with no single right answer. Pinned rather than left
   * to chance — `reviewer` flagged the autumn one as defensible but undocumented,
   * and an undocumented tie-break is one somebody later "fixes" in the other
   * direction without knowing a choice was made.
   */
  it('resolves the ambiguous autumn hour to its second occurrence, so it round-trips', () => {
    // 02:30 happens twice on 2026-10-25. Picking CET (+1) means formatRideTime
    // draws back exactly what the organizer typed.
    expect(wallClockToUtc('2026-10-25T02:30')).toBe('2026-10-25T01:30:00.000Z')
    expect(formatRideTime(wallClockToUtc('2026-10-25T02:30'))).toBe('02:30')
  })

  it('lands the nonexistent spring hour on the following hour', () => {
    // 02:30 does not exist on 2026-03-29 — the clock jumps 02:00 to 03:00. There
    // is no instant to return, so this is the conventional choice and the only
    // input in the year that does not round-trip.
    expect(wallClockToUtc('2026-03-29T02:30')).toBe('2026-03-29T01:30:00.000Z')
    expect(formatRideTime(wallClockToUtc('2026-03-29T02:30'))).toBe('03:30')
  })
})
