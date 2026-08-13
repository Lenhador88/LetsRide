import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultRideDepartureInput,
  formatNotificationStamp,
  formatPostcardDate,
  formatRelativeTime,
  formatRideDate,
  formatRideDateLong,
  formatRideDepartureInput,
  formatRideMessageDay,
  formatRideTime,
  notificationSection,
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

/**
 * The read-side counterpart to `wallClockToUtc`, and the same trap applies:
 * `TZ=UTC` on the runner would let a naive implementation (the browser's own
 * zone, or a bare `toISOString().slice(0, 16)`) pass here and still be wrong on
 * a rider's phone. Every assertion asserts an offset.
 */
describe('formatRideDepartureInput', () => {
  it('renders a summer instant as CEST (UTC+2) wall-clock', () => {
    expect(formatRideDepartureInput('2026-08-16T08:00:00.000Z')).toBe('2026-08-16T10:00')
  })

  it('renders a winter instant as CET (UTC+1) wall-clock', () => {
    expect(formatRideDepartureInput('2026-11-16T09:00:00.000Z')).toBe('2026-11-16T10:00')
  })

  it('round-trips through wallClockToUtc, which is the whole reason it exists', () => {
    // A rider re-opening the edit form must see back exactly what a save
    // wrote — the round trip an edit screen has and a create screen cannot.
    const stored = '2026-08-16T18:00:00.000Z'
    expect(wallClockToUtc(formatRideDepartureInput(stored))).toBe(stored)

    const winterStored = '2026-01-05T06:45:00.000Z'
    expect(wallClockToUtc(formatRideDepartureInput(winterStored))).toBe(winterStored)
  })

  it('renders midnight as 00:00, not 24:00', () => {
    // 2026-08-16T00:00 CEST is 2026-08-15T22:00Z.
    expect(formatRideDepartureInput('2026-08-15T22:00:00.000Z')).toBe('2026-08-16T00:00')
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

describe('formatRideMessageDay', () => {
  const now = new Date('2026-08-07T12:00:00Z')

  it('names today and yesterday rather than dating them', () => {
    expect(formatRideMessageDay('2026-08-07T09:00:00Z', now)).toBe('TODAY')
    expect(formatRideMessageDay('2026-08-06T09:00:00Z', now)).toBe('YESTERDAY')
  })

  it('falls back to the ride list card’s date shape further back', () => {
    expect(formatRideMessageDay('2026-08-01T09:00:00Z', now)).toBe('SAT, 1 AUG')
  })

  it('decides "today" in APP_TIME_ZONE', () => {
    // 22:30Z on the 7th is 00:30 on the 8th in Amsterdam — tomorrow relative to
    // a `now` of midday on the 7th, so it is not "TODAY". A runtime-zone
    // implementation would call it today and disagree with the 00:30 stamped on
    // the message itself.
    expect(formatRideMessageDay('2026-08-07T22:30:00Z', now)).not.toBe('TODAY')
  })

  it('is uppercase throughout, so the separators read as one component', () => {
    for (const day of ['2026-08-07T09:00:00Z', '2026-08-06T09:00:00Z', '2026-07-01T09:00:00Z']) {
      const label = formatRideMessageDay(day, now)
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
    expect(wallClockToUtc(defaultRideDepartureInput())).toBe('2026-07-02T08:00:00.000Z')

    at('2026-12-01T09:00:00Z')
    expect(wallClockToUtc(defaultRideDepartureInput())).toBe('2026-12-02T09:00:00.000Z')
  })
})
