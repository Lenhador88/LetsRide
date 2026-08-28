import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_TIME_ZONE,
  countryFlagEmoji,
  defaultRideDepartureInput,
  formatNotificationStamp,
  formatPostcardDate,
  formatRelativeTime,
  formatRideCardDay,
  formatRideChipDate,
  formatRideDate,
  formatRideDateLong,
  formatRideDepartureInput,
  formatStartDistance,
  formatChatMessageDay,
  formatRideTime,
  notificationSection,
  rideDayStartUtc,
  rideZone,
  rideZoneDayKey,
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
    expect(formatRideDate('2024-11-16T10:00:00Z', null)).toBe('SAT, 16 NOV')
    expect(formatRideDate('2024-11-17T13:30:00Z', null)).toBe('SUN, 17 NOV')
  })

  it('puts the day before the month, as en-GB does', () => {
    // For a European rider app. An en-US ordering would read "NOV 16".
    expect(formatRideDate('2026-01-02T09:00:00Z', null)).toBe('FRI, 2 JAN')
  })
})

describe('formatRideDateLong', () => {
  it('reads as the ride detail draws it — long weekday, sentence case, no year', () => {
    expect(formatRideDateLong('2024-11-16T10:00:00Z', null)).toBe('Saturday, 16 Nov')
    expect(formatRideDateLong('2026-01-02T09:00:00Z', null)).toBe('Friday, 2 Jan')
  })

  it('differs from the list card only in weekday length and case', () => {
    // The two are separate functions rather than one with a flag, so this is
    // the assertion that keeps them from quietly converging.
    expect(formatRideDate('2024-11-16T10:00:00Z', null)).toBe('SAT, 16 NOV')
    expect(formatRideDateLong('2024-11-16T10:00:00Z', null)).toBe('Saturday, 16 Nov')
  })

  it('keeps the comma after the weekday that en-GB omits on its own', () => {
    expect(formatRideDateLong('2024-11-16T10:00:00Z', null)).toContain(', ')
  })
})

describe('formatRideCardDay', () => {
  // A Wednesday, 12:00 Amsterdam. Every case below is expressed as an offset
  // from this instant so the band boundaries are readable as days rather than
  // as dates that have to be counted out by hand.
  const now = new Date('2026-08-26T10:00:00Z')
  const at = (dayOffset: number, hourUtc = 10) => {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() + dayOffset)
    d.setUTCHours(hourUtc, 0, 0, 0)
    return d.toISOString()
  }

  it('names the three days a rider thinks of by name', () => {
    expect(formatRideCardDay(at(-1), null, now)).toBe('Yesterday')
    expect(formatRideCardDay(at(0), null, now)).toBe('Today')
    expect(formatRideCardDay(at(1), null, now)).toBe('Tomorrow')
  })

  it('reads the rest of this week as “This ⟨weekday⟩”', () => {
    expect(formatRideCardDay(at(2), null, now)).toBe('This Friday')
    expect(formatRideCardDay(at(4), null, now)).toBe('This Sunday')
    // The last day of the band: six ahead is still the *next* Tuesday there is.
    expect(formatRideCardDay(at(6), null, now)).toBe('This Tuesday')
  })

  it('reads the week after that as “Next ⟨weekday⟩”', () => {
    // Seven ahead is the same weekday as today, which is the one case where
    // "This Wednesday" would be actively wrong — today is Wednesday.
    expect(formatRideCardDay(at(7), null, now)).toBe('Next Wednesday')
    expect(formatRideCardDay(at(13), null, now)).toBe('Next Tuesday')
  })

  it('falls back to the plain card date outside the two bands', () => {
    expect(formatRideCardDay(at(14), null, now)).toBe(formatRideDate(at(14), null))
    expect(formatRideCardDay(at(-2), null, now)).toBe(formatRideDate(at(-2), null))
    expect(formatRideCardDay(at(-400), null, now)).toBe(formatRideDate(at(-400), null))
  })

  // The band is a CALENDAR difference, so a ride eight hours away can be
  // "Tomorrow" and one twenty hours away can still be "Today". A naive
  // `(b - a) / 86400000` passes the offsets above and fails both of these.
  it('buckets by calendar day, not by elapsed hours', () => {
    const lateTonight = new Date('2026-08-26T20:00:00Z') // 22:00 Amsterdam
    // 01:00 Amsterdam the next day — five hours away, and Tomorrow.
    expect(formatRideCardDay('2026-08-26T23:00:00Z', null, lateTonight)).toBe('Tomorrow')
    const earlyMorning = new Date('2026-08-26T04:00:00Z') // 06:00 Amsterdam
    // 23:00 Amsterdam the same evening — nineteen hours away, and Today.
    expect(formatRideCardDay('2026-08-26T21:00:00Z', null, earlyMorning)).toBe('Today')
  })

  // The whole point of the required zone argument: the ride's own day, never
  // the runner's and never the reader's. `TZ=UTC` here, so a helper that
  // skipped `rideZone` would answer 'Today' for both.
  it('buckets in the ride’s own zone, on both sides of the comparison', () => {
    // 23:30 UTC on the 26th is already 01:30 on the 27th in Amsterdam, and
    // still 19:30 on the 26th in New York.
    const instant = '2026-08-26T23:30:00Z'
    const clock = new Date('2026-08-26T12:00:00Z')
    expect(formatRideCardDay(instant, 'Europe/Amsterdam', clock)).toBe('Tomorrow')
    expect(formatRideCardDay(instant, 'America/New_York', clock)).toBe('Today')
  })

  // `rideZone` swallows a name ICU cannot format; the band must still resolve
  // rather than throw out of a card and take the list with it.
  it('falls back to the app zone for a zone this runtime does not know', () => {
    expect(formatRideCardDay(at(1), 'Mars/Olympus_Mons', now)).toBe('Tomorrow')
  })
})

describe('formatStartDistance', () => {
  it('rounds to whole kilometres, which is all the inputs support', () => {
    expect(formatStartDistance(12)).toBe('12 km away')
    expect(formatStartDistance(11.6)).toBe('12 km away')
    expect(formatStartDistance(1.2)).toBe('1 km away')
  })

  it('never says “0 km away”', () => {
    expect(formatStartDistance(0)).toBe('Under 1 km away')
    expect(formatStartDistance(0.4)).toBe('Under 1 km away')
    // 0.6 rounds to 1, so the branch has to be the value and not the rounding.
    expect(formatStartDistance(0.6)).toBe('Under 1 km away')
  })

  it('groups a long distance rather than printing a bare integer', () => {
    expect(formatStartDistance(1240)).toBe('1,240 km away')
  })

  it('refuses a number that is not a distance', () => {
    expect(formatStartDistance(Number.NaN)).toBeNull()
    expect(formatStartDistance(Number.POSITIVE_INFINITY)).toBeNull()
    expect(formatStartDistance(-3)).toBeNull()
  })
})

describe('formatRideChipDate', () => {
  it('splits day and month into two uppercase parts, Amsterdam wall clock', () => {
    expect(formatRideChipDate('2024-11-16T23:30:00Z', null)).toEqual({ day: '17', month: 'NOV' })
    expect(formatRideChipDate('2026-01-02T09:00:00Z', null)).toEqual({ day: '2', month: 'JAN' })
  })
})

describe('formatRideTime', () => {
  it('is a 24-hour clock, zero-padded', () => {
    // CET in November, so these are the UTC instants plus one hour.
    expect(formatRideTime('2024-11-16T10:00:00Z', null)).toBe('11:00')
    expect(formatRideTime('2024-11-17T13:30:00Z', null)).toBe('14:30')
    expect(formatRideTime('2024-11-17T08:05:00Z', null)).toBe('09:05')
  })

  it('does not roll midnight over to 24:00', () => {
    expect(formatRideTime('2024-11-16T23:00:00Z', null)).toBe('00:00')
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
    expect(formatRideTime('2024-07-16T10:00:00Z', null)).toBe('12:00')
  })

  it('applies the +1 winter offset (CET), so DST is handled rather than fixed', () => {
    expect(formatRideTime('2024-11-16T10:00:00Z', null)).toBe('11:00')
  })

  it('rolls the date with the time, so the two helpers cannot disagree', () => {
    // 23:30 UTC is already the next day in Amsterdam. The date helpers have to
    // move with the clock or a ride reads "Saturday" over "00:30 Sunday".
    const lateUtc = '2024-11-16T23:30:00Z'
    expect(formatRideTime(lateUtc, null)).toBe('00:30')
    expect(formatRideDate(lateUtc, null)).toBe('SUN, 17 NOV')
    expect(formatRideDateLong(lateUtc, null)).toBe('Sunday, 17 Nov')
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

// Every value below is drawn straight from `Inbox - Notifications`
// (`npm run figma -- text "Inbox - Notifications"`) except the `mo`/`y`
// boundaries, which the frame never reaches — those are the inferred
// extension `formatNotificationStamp`'s own docstring flags.
describe('formatNotificationStamp', () => {
  const now = new Date('2026-08-07T12:00:00Z')
  const ago = (seconds: number) =>
    formatNotificationStamp(new Date(now.getTime() - seconds * 1000).toISOString(), now)

  it('reads "now" under a minute', () => {
    expect(ago(0)).toBe('now')
    expect(ago(59)).toBe('now')
  })

  it('matches the drawn stamps exactly', () => {
    expect(ago(2 * 60)).toBe('2m')
    expect(ago(23 * 60)).toBe('23m')
    expect(ago(1 * 24 * 60 * 60)).toBe('1d')
    expect(ago(2 * 24 * 60 * 60)).toBe('2d')
    expect(ago(3 * 24 * 60 * 60)).toBe('3d')
    expect(ago(5 * 24 * 60 * 60)).toBe('5d')
    expect(ago(2 * 7 * 24 * 60 * 60)).toBe('2w')
  })

  it('floors rather than rounds, so it does not jump a unit early', () => {
    expect(ago(23 * 60 + 59)).toBe('23m') // 23m59s reads 23m, not 24m
    expect(ago(6 * 24 * 60 * 60 + 60 * 60 * 23)).toBe('6d') // just under a week
  })

  it('switches units at the boundary', () => {
    expect(ago(60)).toBe('1m')
    expect(ago(60 * 60)).toBe('1h')
    expect(ago(24 * 60 * 60)).toBe('1d')
    expect(ago(7 * 24 * 60 * 60)).toBe('1w')
  })

  it('extends to months and years beyond the drawn 5-week ceiling', () => {
    expect(ago(35 * 24 * 60 * 60)).toBe('1mo')
    expect(ago(365 * 24 * 60 * 60)).toBe('1y')
  })

  // Regression: `days / 30` reaches 12 on day 360 while `days / 365` is still
  // 0 until day 365, so gating the years branch on the derived month count
  // drew `0y` for that five-day window. The pair above stepped straight over
  // it — 35d and 365d are both outside the seam.
  it('stays monotonic across the month/year seam', () => {
    const day = 24 * 60 * 60
    expect(ago(359 * day)).toBe('11mo')
    expect(ago(360 * day)).toBe('11mo')
    expect(ago(364 * day)).toBe('11mo')
    expect(ago(365 * day)).toBe('1y')
    expect(ago(400 * day)).toBe('1y')
    expect(ago(730 * day)).toBe('2y')
  })

  it('never produces a negative unit for a future timestamp', () => {
    const future = new Date(now.getTime() + 60_000).toISOString()
    expect(formatNotificationStamp(future, now)).toBe('now')
  })
})

// The 7-day rolling "This week" window is inferred rather than drawn — the
// frame shows the four section names and never says where the third ends —
// and is logged as such in docs/FIGMA-FIDELITY-TODO.md. These pin the
// behaviour that was chosen so a later change to it is deliberate.
//
// Boundaries resolve through `rideZoneDayKey` in APP_TIME_ZONE, not UTC, which
// is the thing this repo has got wrong before: vitest.config.ts pins TZ=UTC,
// so a naive implementation reading the runtime zone would pass a test written
// in UTC and mis-section a row for a real rider in Amsterdam.
describe('notificationSection', () => {
  const day = 24 * 60 * 60 * 1000
  // 12:00 UTC is 14:00 in Amsterdam — comfortably mid-day in both, so the
  // arithmetic below cannot straddle a day boundary by accident.
  const now = new Date('2026-08-07T12:00:00Z')
  const ago = (ms: number) => notificationSection(new Date(now.getTime() - ms).toISOString(), now)

  it('sections the day it happened as Today', () => {
    expect(ago(0)).toBe('Today')
    expect(ago(60 * 1000)).toBe('Today')
  })

  it('sections the calendar day before as Yesterday', () => {
    expect(ago(day)).toBe('Yesterday')
  })

  it('sections the rest of the trailing week as This week', () => {
    expect(ago(2 * day)).toBe('This week')
    expect(ago(6 * day)).toBe('This week')
    expect(ago(7 * day)).toBe('This week')
  })

  it('sections anything older as All time', () => {
    expect(ago(8 * day)).toBe('All time')
    expect(ago(60 * day)).toBe('All time')
  })

  // Today is a calendar-day comparison, not a 24-hour one: 23:00 Amsterdam
  // and 00:30 Amsterdam are 90 minutes apart and belong to different sections.
  it('splits Today from Yesterday on the zone’s calendar boundary, not on elapsed hours', () => {
    const justAfterMidnight = new Date('2026-08-07T22:30:00Z') // 00:30 Amsterdam, 8 Aug
    expect(notificationSection('2026-08-07T21:00:00Z', justAfterMidnight)).toBe('Yesterday')
    expect(notificationSection('2026-08-07T22:15:00Z', justAfterMidnight)).toBe('Today')
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

describe('countryFlagEmoji', () => {
  it('turns an uppercase alpha-2 code into its regional-indicator pair', () => {
    expect(countryFlagEmoji('NL')).toBe('🇳🇱')
  })

  it('accepts a lowercase code too — the vendor documents lowercase', () => {
    expect(countryFlagEmoji('nl')).toBe('🇳🇱')
  })

  it('accepts a mixed-case code', () => {
    expect(countryFlagEmoji('Nl')).toBe('🇳🇱')
  })

  it('returns null for anything that is not two letters, rather than mojibake', () => {
    // `String.fromCodePoint` on a non-letter offset is what "mojibake" means
    // here — a printable but meaningless glyph, not a thrown error.
    for (const bad of ['N', 'NLD', '12', 'N1', '', '  ']) {
      expect(countryFlagEmoji(bad)).toBeNull()
    }
  })

  it('returns null for null and undefined, never the empty string', () => {
    expect(countryFlagEmoji(null)).toBeNull()
    expect(countryFlagEmoji(undefined)).toBeNull()
  })
})


/**
 * `080` (PD-193) — a ride carries the zone its meeting point is in, and every
 * `formatRide*` helper reads it.
 *
 * **The same trap governs this whole block as governs the two above it.**
 * `vitest.config.ts` pins `TZ=UTC`, so an implementation that ignored its `zone`
 * argument entirely would still pass any assertion whose expected value happens
 * to be the UTC one. Every assertion here therefore asserts an OFFSET the runner
 * does not have — and the summer/winter pairs assert that the offset is looked
 * up per instant rather than fixed, which is the half a constant cannot fake.
 */
describe('rideZone', () => {
  it('answers with the ride’s own zone when the runtime can format in it', () => {
    expect(rideZone('Europe/Lisbon')).toBe('Europe/Lisbon')
    expect(rideZone('America/New_York')).toBe('America/New_York')
  })

  it('falls back for "we do not know", which is what NULL means on the column', () => {
    expect(rideZone(null)).toBe(APP_TIME_ZONE)
    expect(rideZone(undefined)).toBe(APP_TIME_ZONE)
    expect(rideZone('')).toBe(APP_TIME_ZONE)
  })

  /**
   * The reason this function exists rather than the formatters reading the
   * column directly. `080`'s trigger validates against `pg_timezone_names`,
   * which is the SERVER's table; ICU's is a different one, so a name can be
   * stored legitimately and still be unknown here. `Intl.DateTimeFormat` throws
   * a RangeError on an unknown `timeZone`, and from inside a ride card that
   * takes down every screen the ride appears on.
   */
  it('falls back rather than throwing on a zone this runtime cannot format in', () => {
    expect(rideZone('Mars/Olympus_Mons')).toBe(APP_TIME_ZONE)
    expect(rideZone('not a zone at all')).toBe(APP_TIME_ZONE)
  })

  it('is what the formatters go through, so an unusable zone degrades everywhere', () => {
    // The assertion that matters is that none of these throw. Falling back to
    // APP_TIME_ZONE is exactly what the ride did before it had a column.
    expect(formatRideTime('2024-11-16T10:00:00Z', 'Mars/Olympus_Mons')).toBe('11:00')
    expect(formatRideDate('2024-11-16T10:00:00Z', 'Mars/Olympus_Mons')).toBe('SAT, 16 NOV')
    expect(formatRideDateLong('2024-11-16T10:00:00Z', 'Mars/Olympus_Mons')).toBe('Saturday, 16 Nov')
    expect(formatRideChipDate('2024-11-16T23:30:00Z', 'Mars/Olympus_Mons')).toEqual({
      day: '17',
      month: 'NOV',
    })
    expect(formatRideDepartureInput('2024-11-16T10:00:00Z', 'Mars/Olympus_Mons')).toBe(
      '2024-11-16T11:00'
    )
    expect(wallClockToUtc('2024-11-16T11:00', 'Mars/Olympus_Mons')).toBe('2024-11-16T10:00:00.000Z')
  })

  it('answers the same on the second call, because the answer is memoised', () => {
    // The cache is keyed on the string, so a repeat must not be a different
    // answer — which a `Map` that stored a falsy value would produce.
    expect(rideZone('Europe/Lisbon')).toBe(rideZone('Europe/Lisbon'))
    expect(rideZone('Mars/Olympus_Mons')).toBe(rideZone('Mars/Olympus_Mons'))
  })
})

describe('a ride reads in its own zone, not the app’s', () => {
  // 10:00 UTC. Amsterdam is CEST (+2) in July; Lisbon is WEST (+1); New York is
  // EDT (-4). Three different wall-clocks for one instant.
  const summer = '2024-07-16T10:00:00Z'

  it('draws the clock at the MEETING POINT, which is the whole story', () => {
    expect(formatRideTime(summer, null)).toBe('12:00')
    expect(formatRideTime(summer, 'Europe/Lisbon')).toBe('11:00')
    expect(formatRideTime(summer, 'America/New_York')).toBe('06:00')
  })

  it('looks the offset up per instant, so DST is handled rather than fixed', () => {
    // Lisbon is +1 in July and +0 in January. A fixed per-zone offset passes the
    // line above and fails this one.
    expect(formatRideTime('2024-07-16T10:00:00Z', 'Europe/Lisbon')).toBe('11:00')
    expect(formatRideTime('2024-01-16T10:00:00Z', 'Europe/Lisbon')).toBe('10:00')
  })

  it('rolls the date with the time in the ride’s zone, not the app’s', () => {
    // 02:30 UTC is already the 17th in Amsterdam and still the 16th in New York.
    const lateUtc = '2024-11-17T02:30:00Z'
    expect(formatRideDate(lateUtc, null)).toBe('SUN, 17 NOV')
    expect(formatRideDate(lateUtc, 'America/New_York')).toBe('SAT, 16 NOV')
    expect(formatRideDateLong(lateUtc, 'America/New_York')).toBe('Saturday, 16 Nov')
    expect(formatRideChipDate(lateUtc, 'America/New_York')).toEqual({ day: '16', month: 'NOV' })
  })
})

describe('a ride WRITES in its own zone, which is the half the read side cannot fix', () => {
  /**
   * PD-193's worked example, end to end. An organizer in Lisbon types 09:00 and
   * every rider — including the one standing at the meeting point — must read
   * 09:00 back. Before the zone column they read 08:00.
   */
  it('round-trips the organizer’s typed wall-clock through storage', () => {
    const stored = wallClockToUtc('2026-08-16T09:00', 'Europe/Lisbon')
    expect(stored).toBe('2026-08-16T08:00:00.000Z')
    expect(formatRideTime(stored, 'Europe/Lisbon')).toBe('09:00')
  })

  it('means a DIFFERENT instant per zone for the same typed string', () => {
    // The defect this closes: one string, one instant, wherever the ride was.
    expect(wallClockToUtc('2026-08-16T09:00', null)).toBe('2026-08-16T07:00:00.000Z')
    expect(wallClockToUtc('2026-08-16T09:00', 'Europe/Lisbon')).toBe('2026-08-16T08:00:00.000Z')
    expect(wallClockToUtc('2026-08-16T09:00', 'America/New_York')).toBe('2026-08-16T13:00:00.000Z')
  })

  it('keeps the two-pass DST correction per zone rather than per app', () => {
    // New York springs forward at 02:00 on 2026-03-08 and Amsterdam does not
    // move that day at all, so the two disagree about this exact input. A single
    // -5 offset would answer 07:30Z for both lines.
    expect(wallClockToUtc('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T06:30:00.000Z')
    expect(wallClockToUtc('2026-03-08T02:30', null)).toBe('2026-03-08T01:30:00.000Z')
  })

  it('round-trips through the edit form’s input, in a zone that is not the app’s', () => {
    // `formatRideDepartureInput` -> `wallClockToUtc` is the edit screen's whole
    // loop: an untouched departure field must reproduce the stored instant, or
    // saving a renamed ride moves it. `080`'s trigger relies on exactly this.
    const stored = '2026-08-16T08:00:00.000Z'
    expect(formatRideDepartureInput(stored, 'Europe/Lisbon')).toBe('2026-08-16T09:00')
    expect(wallClockToUtc(formatRideDepartureInput(stored, 'Europe/Lisbon'), 'Europe/Lisbon')).toBe(
      stored
    )

    const winter = '2026-01-05T09:00:00.000Z'
    expect(wallClockToUtc(formatRideDepartureInput(winter, 'Europe/Lisbon'), 'Europe/Lisbon')).toBe(
      winter
    )
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
    expect(wallClockToUtc('2026-08-16T10:00', null)).toBe('2026-08-16T08:00:00.000Z')
  })

  it('reads a winter wall clock as CET (UTC+1)', () => {
    expect(wallClockToUtc('2026-11-16T10:00', null)).toBe('2026-11-16T09:00:00.000Z')
  })

  /**
   * The reason for the second pass. A first guess taken at the naive instant
   * lands on the wrong side of the transition here, and correcting the offset
   * once against that guess is what fixes it.
   */
  it('is correct on both sides of the DST transition', () => {
    // 2026-03-29 02:00 CET -> 03:00 CEST.
    expect(wallClockToUtc('2026-03-29T01:00', null)).toBe('2026-03-29T00:00:00.000Z')
    expect(wallClockToUtc('2026-03-29T04:00', null)).toBe('2026-03-29T02:00:00.000Z')
    // 2026-10-25 03:00 CEST -> 02:00 CET.
    expect(wallClockToUtc('2026-10-25T04:00', null)).toBe('2026-10-25T03:00:00.000Z')
  })

  it('round-trips through the reader it exists to agree with', () => {
    expect(formatRideTime(wallClockToUtc('2026-08-16T20:00', null), null)).toBe('20:00')
    expect(formatRideTime(wallClockToUtc('2026-01-05T07:45', null), null)).toBe('07:45')
  })

  it('accepts a value that already carries seconds', () => {
    expect(wallClockToUtc('2026-08-16T10:00:30', null)).toBe('2026-08-16T08:00:30.000Z')
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
    expect(wallClockToUtc('2026-10-25T02:30', null)).toBe('2026-10-25T01:30:00.000Z')
    expect(formatRideTime(wallClockToUtc('2026-10-25T02:30', null), null)).toBe('02:30')
  })

  it('lands the nonexistent spring hour on the following hour', () => {
    // 02:30 does not exist on 2026-03-29 — the clock jumps 02:00 to 03:00. There
    // is no instant to return, so this is the conventional choice and the only
    // input in the year that does not round-trip.
    expect(wallClockToUtc('2026-03-29T02:30', null)).toBe('2026-03-29T01:30:00.000Z')
    expect(formatRideTime(wallClockToUtc('2026-03-29T02:30', null), null)).toBe('03:30')
  })
})

/**
 * The read-side counterpart to `wallClockToUtc`, and the same trap applies:
 * `TZ=UTC` on the runner would let a naive implementation (the browser's own
 * zone, or a bare `toISOString().slice(0, 16)`) pass here and still be wrong on
 * a rider's phone. Every assertion asserts an offset.
 */
describe('formatRideDepartureInput', () => {
  it('renders a summer instant as CEST (UTC+2) wall-clock', () => {
    expect(formatRideDepartureInput('2026-08-16T08:00:00.000Z', null)).toBe('2026-08-16T10:00')
  })

  it('renders a winter instant as CET (UTC+1) wall-clock', () => {
    expect(formatRideDepartureInput('2026-11-16T09:00:00.000Z', null)).toBe('2026-11-16T10:00')
  })

  it('round-trips through wallClockToUtc, which is the whole reason it exists', () => {
    // A rider re-opening the edit form must see back exactly what a save
    // wrote — the round trip an edit screen has and a create screen cannot.
    const stored = '2026-08-16T18:00:00.000Z'
    expect(wallClockToUtc(formatRideDepartureInput(stored, null), null)).toBe(stored)

    const winterStored = '2026-01-05T06:45:00.000Z'
    expect(wallClockToUtc(formatRideDepartureInput(winterStored, null), null)).toBe(winterStored)
  })

  it('renders midnight as 00:00, not 24:00', () => {
    // 2026-08-16T00:00 CEST is 2026-08-15T22:00Z.
    expect(formatRideDepartureInput('2026-08-15T22:00:00.000Z', null)).toBe('2026-08-16T00:00')
  })
})

describe('rideZoneDayKey', () => {
  it('answers in APP_TIME_ZONE, not the runtime zone', () => {
    // TZ is pinned to UTC on the runner, so a helper reading the process zone
    // would answer `2026-08-07` for both. In Europe/Amsterdam (UTC+2 in August)
    // the second instant is already the 8th, which is the whole point: the day
    // separator has to agree with the timestamps beside it, and those are
    // pinned too.
    expect(rideZoneDayKey('2026-08-07T21:30:00Z')).toBe('2026-08-07')
    expect(rideZoneDayKey('2026-08-07T22:30:00Z')).toBe('2026-08-08')
  })

  it('is ISO-ordered, so string comparison is date comparison', () => {
    expect(rideZoneDayKey('2026-01-02T12:00:00Z')).toBe('2026-01-02')
  })

  it('handles the winter offset too — the zone is not a fixed +2', () => {
    // CET, UTC+1. 23:30Z is still the same day in Amsterdam in January, where
    // in August it would have rolled over.
    expect(rideZoneDayKey('2026-01-07T22:30:00Z')).toBe('2026-01-07')
    expect(rideZoneDayKey('2026-01-07T23:30:00Z')).toBe('2026-01-08')
  })
})

describe('rideDayStartUtc', () => {
  it('is midnight in APP_TIME_ZONE, not midnight UTC', () => {
    // CEST, UTC+2 — so the day that starts on 16 August in Amsterdam starts at
    // 22:00Z on the 15th. TZ is pinned to UTC on the runner, so a helper that
    // read the process zone would answer `2026-08-16T00:00:00.000Z` here and
    // file nothing under Past rides for two hours a day.
    expect(rideDayStartUtc(Date.parse('2026-08-16T09:00:00Z'))).toBe('2026-08-15T22:00:00.000Z')
  })

  it('follows the winter offset — the zone is not a fixed +2', () => {
    // CET, UTC+1.
    expect(rideDayStartUtc(Date.parse('2026-01-16T09:00:00Z'))).toBe('2026-01-15T23:00:00.000Z')
  })

  it('does not move for an instant later the same day', () => {
    // The whole point of the boundary: a ride at 15:00 and a rider looking at
    // 23:00 are cut against the same instant, so nothing crosses into Previous
    // rides during the day it happened.
    const afternoon = rideDayStartUtc(Date.parse('2026-08-16T13:00:00Z'))
    const lateEvening = rideDayStartUtc(Date.parse('2026-08-16T21:00:00Z'))
    expect(afternoon).toBe(lateEvening)
  })

  it('rolls over at local midnight, not at 00:00Z', () => {
    // 21:59Z on the 16th is 23:59 in Amsterdam — still the 16th. Two minutes
    // later it is the 17th there, and the ride that departed that afternoon
    // becomes a previous ride.
    expect(rideDayStartUtc(Date.parse('2026-08-16T21:59:00Z'))).toBe('2026-08-15T22:00:00.000Z')
    expect(rideDayStartUtc(Date.parse('2026-08-16T22:01:00Z'))).toBe('2026-08-16T22:00:00.000Z')
  })

  it('is right on both DST days, where midnight itself is not the transition', () => {
    // Spring forward is 02:00 -> 03:00 on 29 March; midnight exists and is CET.
    expect(rideDayStartUtc(Date.parse('2026-03-29T12:00:00Z'))).toBe('2026-03-28T23:00:00.000Z')
    // Autumn back is 03:00 -> 02:00 on 25 October; midnight exists and is CEST.
    expect(rideDayStartUtc(Date.parse('2026-10-25T12:00:00Z'))).toBe('2026-10-24T22:00:00.000Z')
  })

  it('puts a ride earlier today on the upcoming side of the cut', () => {
    // The comparison every card and both queries make.
    const now = Date.parse('2026-08-16T21:00:00Z') // 23:00 Amsterdam
    const departed = Date.parse('2026-08-16T13:00:00Z') // 15:00 Amsterdam
    expect(departed >= Date.parse(rideDayStartUtc(now))).toBe(true)

    const yesterday = Date.parse('2026-08-15T13:00:00Z')
    expect(yesterday >= Date.parse(rideDayStartUtc(now))).toBe(false)
  })
})

describe('formatChatMessageDay', () => {
  const now = new Date('2026-08-07T12:00:00Z')

  it('names today and yesterday rather than dating them', () => {
    expect(formatChatMessageDay('2026-08-07T09:00:00Z', now)).toBe('TODAY')
    expect(formatChatMessageDay('2026-08-06T09:00:00Z', now)).toBe('YESTERDAY')
  })

  it('falls back to the ride list card’s date shape further back', () => {
    expect(formatChatMessageDay('2026-08-01T09:00:00Z', now)).toBe('SAT, 1 AUG')
  })

  it('decides "today" in APP_TIME_ZONE', () => {
    // 22:30Z on the 7th is 00:30 on the 8th in Amsterdam — tomorrow relative to
    // a `now` of midday on the 7th, so it is not "TODAY". A runtime-zone
    // implementation would call it today and disagree with the 00:30 stamped on
    // the message itself.
    expect(formatChatMessageDay('2026-08-07T22:30:00Z', now)).not.toBe('TODAY')
  })

  it('is uppercase throughout, so the separators read as one component', () => {
    for (const day of ['2026-08-07T09:00:00Z', '2026-08-06T09:00:00Z', '2026-07-01T09:00:00Z']) {
      const label = formatChatMessageDay(day, now)
      expect(label).toBe(label.toUpperCase())
    }
  })
})

describe('defaultRideDepartureInput', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const at = (iso: string) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('opens on tomorrow at 10:00', () => {
    at('2026-08-13T09:00:00Z')
    expect(defaultRideDepartureInput()).toBe('2026-08-14T10:00')
  })

  // The assertion `TZ=UTC` exists to let through. At 22:30Z on the 13th it is
  // already 00:30 on the **14th** in Amsterdam, so tomorrow is the 15th — an
  // implementation reading the runtime's own day answers the 14th, which is
  // today by the only clock this screen uses and is a date `wallClockToUtc`
  // then resolves into the past.
  it('takes tomorrow from APP_TIME_ZONE, not from the runtime', () => {
    at('2026-08-13T22:30:00Z')
    expect(defaultRideDepartureInput()).toBe('2026-08-15T10:00')
  })

  it('rolls over the end of a month', () => {
    at('2026-08-31T09:00:00Z')
    expect(defaultRideDepartureInput()).toBe('2026-09-01T10:00')
  })

  it('rolls over the end of a year', () => {
    at('2026-12-31T09:00:00Z')
    expect(defaultRideDepartureInput()).toBe('2027-01-01T10:00')
  })

  // Not a date-shape check: it is the whole round trip. What this function
  // seeds has to survive `wallClockToUtc` as 10:00 Amsterdam on both sides of a
  // DST boundary, which is where an offset-arithmetic implementation lands an
  // hour out — 09:00Z in summer, 08:00Z... the other way round in winter.
  it('seeds a value that resolves to 10:00 Amsterdam in summer and in winter', () => {
    at('2026-07-01T09:00:00Z')
    expect(wallClockToUtc(defaultRideDepartureInput(), null)).toBe('2026-07-02T08:00:00.000Z')

    at('2026-12-01T09:00:00Z')
    expect(wallClockToUtc(defaultRideDepartureInput(), null)).toBe('2026-12-02T09:00:00.000Z')
  })
})
