import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The zone every ride time is rendered in.
 *
 * Ride dates and times are formatted on the **server**, so without this they
 * render in the server's zone — which on Vercel is UTC. A ride departing at
 * 20:00 in Amsterdam was being drawn as `18:00`, two hours wrong, on the one
 * screen where the hour is the single fact a rider acts on. The unit tests
 * missed it because `vitest.config.ts` pins `TZ=UTC`, so the environment that
 * hid the bug in production was also the one asserting the behaviour.
 *
 * **This is an interim, and a deliberate one.** The correct answer is the wall
 * clock *at the meeting point* — a ride in Lisbon reads 10:00 to everyone,
 * wherever they are looking from — and that needs a zone column on `rides`
 * beside the timestamp. Until it exists, a fixed European zone is right for the
 * whole current user base where UTC is wrong for all of it, and it is one
 * constant to delete when the column lands. It is not the viewer's zone either:
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` would be per-viewer correct
 * and would also make the server and client render different strings, which is a
 * hydration mismatch on every ride card.
 *
 * Applies to the three `formatRide*` helpers, which after this change are the
 * only zone-dependent formatters left — `formatPostcardDate` is a photo stamp
 * and `formatRelativeTime` works on elapsed instants, which no zone changes.
 */
export const APP_TIME_ZONE = 'Europe/Amsterdam'

/** What `APP_TIME_ZONE` was offset from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)

  // `hour` comes back as 24 at midnight under hour12:false, which Date.UTC
  // rolls into the next day — correct here only because the modulo keeps it 0.
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  )

  return asIfUtc - instant.getTime()
}

/**
 * Turns a zone-less `datetime-local` value into the UTC instant it names **in
 * `APP_TIME_ZONE`**.
 *
 * This is the write-side half of the bug #37 fixed on the read side. `new
 * Date('2026-08-16T10:00')` resolves in whatever zone the runtime is in — the
 * browser's for a client component, UTC on Vercel for a server one — so the
 * same string typed by two organizers meant two different instants, and neither
 * matched what `formatRideDate` would draw it back as.
 *
 * Two passes, and the second is not redundant. The offset depends on the
 * instant, and the instant is what we are solving for; on the two DST days a
 * year the first guess lands on the wrong side of the transition and the second
 * pass corrects it. On every other day the two agree.
 *
 * **The two hours a year that have no single right answer**, stated because a
 * reader will otherwise assume they were not considered:
 *
 * - *Ambiguous*, the autumn hour that happens twice (`2026-10-25T02:30` in
 *   Amsterdam). This picks the **second** occurrence, CET at +1 — so the value
 *   round-trips through `formatRideTime` and a rider sees back what they typed.
 * - *Nonexistent*, the spring hour that is skipped (`2026-03-29T02:30`). There
 *   is no instant to return, so it lands on 03:30 — the conventional choice, and
 *   the only input in the year that does not round-trip.
 *
 * Both are pinned by tests. A ride departing in either hour is not a scenario
 * worth more machinery than this; a zone column on `rides` is the real answer
 * and it changes this function anyway.
 *
 * The correct long-term model is a zone column on `rides` — a ride meets
 * somewhere, and that somewhere has a clock. This keeps writes consistent with
 * the three `formatRide*` readers until that exists.
 */
export function wallClockToUtc(local: string): string {
  // `Z` makes the parse deterministic instead of runtime-dependent; the result
  // is then corrected by the zone's real offset rather than trusted.
  const naive = new Date(`${local.length === 16 ? `${local}:00` : local}Z`)
  if (Number.isNaN(naive.getTime())) return new Date(local).toISOString()

  const firstPass = naive.getTime() - zoneOffsetMs(naive)
  const corrected = naive.getTime() - zoneOffsetMs(new Date(firstPass))
  return new Date(corrected).toISOString()
}

/**
 * A Google Maps **directions** link to a free-text destination.
 *
 * `maps/dir/?api=1&destination=…`, not `maps/search/?api=1&query=…`. The search
 * endpoint drops a pin and stops there — which is what riders reported: tapping
 * the map "only highlights the location". `dir` with a `destination` and no
 * `origin` makes Google route from wherever the rider currently is, which is the
 * thing the tap was always meant to do.
 *
 * `travelmode=driving` because the Maps **URLs** API documents exactly four
 * values — `driving`, `walking`, `bicycling`, `transit`. The `two-wheeler` mode
 * a motorcycle app would want belongs to the Routes/Directions *web service*,
 * which is a keyed, billed API and not this one; passing it here is not a
 * degraded option, it is not a value this endpoint accepts.
 *
 * `URLSearchParams` rather than `encodeURIComponent`, so an address containing
 * `&` or `#` cannot truncate the query — the previous hand-built string would
 * have silently lost everything after an ampersand.
 */
export function googleMapsDirectionsUrl(destination: string) {
  const params = new URLSearchParams({
    api: '1',
    destination,
    travelmode: 'driving',
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/**
 * The date stamped on a postcard photo — `19 Nov 2024`.
 *
 * Named for its screen rather than generic, because the design gives this one a
 * distinct shape: day first, short month, no weekday, sized to sit in the corner
 * of a photo. `en-GB` gives that day-first order; the design's lowercase month
 * ("19 nov 2024") is Dutch, which is the locale its mock content is written in
 * rather than a choice about the app's.
 *
 * Deliberately **not** pinned to APP_TIME_ZONE. This is the date a photo was
 * taken, stamped on the photo; the zone that matters is the one the rider was
 * standing in, which the schema does not record either way.
 */
export function formatPostcardDate(date: string) {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * The date on a ride list card — `SAT, 16 NOV`, uppercased as the design draws
 * it (`v2 / Component / List / Ride`, Poppins/14/Medium).
 *
 * `en-GB` for the same reason `formatPostcardDate` uses it: day-first order and
 * a 24-hour clock, which is what the design shows and what a European rider
 * expects. It deliberately does not touch the `en-US` hardcoding in the three
 * functions below — that is a known bug the three have to fix together.
 *
 * The year is omitted, exactly as drawn. That is fine for the upcoming rides
 * this list shows and wrong the day it shows history; noted in
 * docs/FIGMA-FIDELITY-TODO.md rather than pre-emptively "fixed" past the design.
 */
export function formatRideDate(date: string) {
  // Assembled from parts rather than taken whole from `toLocaleDateString`,
  // because en-GB's short date is "Sat 16 Nov" and the design draws a comma
  // after the weekday. The parts still come from Intl, so the weekday and month
  // names stay the locale's — only the punctuation is ours.
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: APP_TIME_ZONE,
  }).formatToParts(new Date(date))

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${find('weekday')}, ${find('day')} ${find('month')}`.toUpperCase()
}

/**
 * `10:00`. The design draws a range (`10:00 - 15:00`) but `rides` has no end
 * time column, so a single departure time is all there is to render — recorded
 * in docs/FIGMA-FIDELITY-TODO.md as blocked on schema, not on the design.
 */
export function formatRideTime(date: string) {
  return new Date(date).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: APP_TIME_ZONE,
  })
}

/*
 * `formatDate` and `formatDateTime` used to sit here. They are **deleted**, not
 * moved, and the deletion is the fix for a defect this change created.
 *
 * `formatDateTime` had exactly one caller — the club page's ride card — and
 * `formatDate` had none at all. Pinning the three `formatRide*` helpers to
 * APP_TIME_ZONE while leaving that caller unpinned made two screens one tap
 * apart disagree about the same ride: `/clubs/[id]` said `06:00 PM` where
 * `/rides/[id]` said `20:00`, and past 22:00 UTC they disagreed about the day.
 * Uniformly wrong had become inconsistently wrong, which is worse.
 *
 * That caller now uses the ride helpers, which is what a ride time should have
 * used regardless — and with it gone both functions had zero callers. Deleting
 * them is therefore the whole fix for their long-standing hardcoded `en-US`
 * too: a bug CLAUDE.md has carried as "known" for two epics, resolved at no
 * cost because nothing was using the code that had it.
 *
 * This is also the grain of the file. Every surviving formatter is named for
 * the screen it serves — `formatPostcardDate`, `formatRideDate`,
 * `formatRideDateLong`, `formatRideTime` — because each design draws a
 * genuinely different shape. A generic `formatDate` invites a call site to take
 * whatever it gives; write the screen's own and let the name say where it
 * belongs.
 */

/**
 * The ride *detail's* date row — `Saturday, 12 Nov`.
 *
 * Separate from `formatRideDate` above rather than a parameter on it, because
 * the two designs genuinely differ: the list card draws a short uppercased
 * weekday (`SAT, 16 NOV`, Poppins/14/Medium) and the detail draws a long one in
 * sentence case (Poppins/14/Semibold). A `long`/`short` flag would read as a
 * preference at every call site when it is really "which screen is this".
 *
 * Same `en-GB`, same parts-assembly, and same reason — see `formatRideDate`.
 *
 * Rendered in `APP_TIME_ZONE`, not the server's. It used to be the server's,
 * which meant UTC on Vercel and every ride drawn two hours early in summer; see
 * that constant for why the fix is a fixed zone rather than the viewer's.
 */
export function formatRideDateLong(date: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: APP_TIME_ZONE,
  }).formatToParts(new Date(date))

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${find('weekday')}, ${find('day')} ${find('month')}`
}

/**
 * Which calendar day an instant falls on **in `APP_TIME_ZONE`**, as `YYYY-MM-DD`.
 *
 * Not a display format — nothing renders this. It exists so `getRideMessages`
 * can decide where a day separator goes, and the comparison has to happen in a
 * fixed zone for the same reason the rendering does: `new Date(a).getDate() !==
 * new Date(b).getDate()` compares in the *runtime's* zone, so two messages
 * either side of midnight Amsterdam would be one day to a rider in Lisbon and
 * two to one in Berlin, and the separator would sit in a different place per
 * device while the times beside it were pinned. A separator that disagrees with
 * the timestamps under it is worse than none.
 *
 * `en-CA` because its short date is already ISO order; the parts are Intl's, so
 * this is a formatting trick rather than arithmetic on the offset.
 */
export function rideZoneDayKey(date: string): string {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE })
}

/**
 * A ride chat's day separator — `Today`, `Yesterday`, or `Sat, 16 Nov`.
 *
 * **The design draws no separator at all**, and this is a deliberate addition
 * rather than a fidelity miss. `Ride - Chat` (`2226:4999`) stamps every bubble
 * with `HH:mm` and nothing else, which is unambiguous for the single-day
 * conversation the frame mocks and silently wrong for a ride planned three weeks
 * out: "08:18" on a message from last Tuesday reads as this morning. Logged in
 * docs/FIGMA-FIDELITY-TODO.md as an addition to check with the designer, not as
 * something inferred and passed off as measured.
 *
 * The bubble time itself reuses `formatRideTime` rather than getting a
 * near-identical twin of its own. This file's rule is that a formatter is named
 * for the screen it serves *because each design draws a different shape* — and
 * here two ride surfaces genuinely draw the same one, `HH:mm` in `en-GB`. A
 * second function with the same body would be the rule's letter against its
 * reason.
 *
 * Pinned to `APP_TIME_ZONE` like every other ride surface. A message stamp is an
 * instant rather than a planned wall-clock, so the viewer's own zone has a real
 * claim here that it does not have on a departure time — but a chat sits one tap
 * from the ride plan, and a thread reading `19:22` beside a departure reading
 * `20:00` in a different zone is the exact two-screen disagreement that deleting
 * `formatDateTime` fixed. Pinned until the zone column lands and moves all of
 * them together.
 */
export function formatRideMessageDay(date: string, now: Date = new Date()): string {
  const key = rideZoneDayKey(date)
  // Uppercased to match `formatRideDate`, which is the branch below and which
  // the design uppercases on the ride card. Mixing `Today` with `SAT, 16 NOV`
  // in one column of separators reads as two different components.
  if (key === rideZoneDayKey(now.toISOString())) return 'TODAY'

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (key === rideZoneDayKey(yesterday.toISOString())) return 'YESTERDAY'

  return formatRideDate(date)
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
]

/**
 * "3 hours ago" for feed bylines. `Intl.RelativeTimeFormat` only, per the
 * no-date-library rule — the whole helper is the unit table above plus a
 * division.
 *
 * Anything under a minute reads "just now" rather than "0 seconds ago", which
 * is what the API would otherwise produce for a postcard posted this second.
 *
 * Locale is `en-US` and that is now the only place in the file it survives.
 * Unlike the date formatters it is defensible here: this produces English
 * prose ("3 hours ago"), so the locale is the app's language rather than a
 * date format, and every string the app writes around it is English too.
 *
 * Needs no timezone. It formats the *distance* between two instants, and the
 * gap between them is the same number of hours in every zone on earth.
 */
export function formatRelativeTime(date: string, now: Date = new Date()) {
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000)
  const magnitude = Math.abs(seconds)

  if (magnitude < 60) return 'just now'

  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (magnitude >= unitSeconds) {
      return formatter.format(Math.round(seconds / unitSeconds), unit)
    }
  }
  return 'just now'
}

// Tolerates null: a rider mid-onboarding has no username yet, and every call
// site reaches this through `username ?? 'Rider'` — but the fallback is one
// edit away from being dropped, and .split on undefined throws.
export function getInitials(name: string | null | undefined) {
  if (!name) return 'R'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}
