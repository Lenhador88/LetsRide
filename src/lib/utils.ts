import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The zone a ride time falls back to when the ride does not carry one of its own.
 *
 * **It stopped being the rule on 2026-08-26 (`080`, PD-193) and is now the
 * fallback.** A ride's meeting point has a clock, and `rides.timezone` is it: a
 * ride in Lisbon reads 09:00 to everyone, wherever they are looking from. NULL
 * there means "we do not know" — every ride created before that column, and any
 * place whose provider sent no zone — and this is what those resolve to, which
 * is exactly the behaviour they had before.
 *
 * **It is still not the viewer's zone, and that is not a leftover.** The SSR
 * pass runs on Vercel, so `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * would render the server's zone into the HTML and the rider's on hydration —
 * a mismatch on every ride card. It is also not what a rider wants: the number
 * they act on is the clock at the meeting point, not the clock where they are
 * reading.
 *
 * Reached through `rideZone()` below rather than referenced directly by any
 * formatter, so an unusable stored zone degrades here rather than throwing.
 * `formatPostcardDate` is a photo stamp and `formatRelativeTime` measures
 * elapsed instants, so neither takes a zone at all.
 */
export const APP_TIME_ZONE = 'Europe/Amsterdam'

/**
 * A zone `Intl` can actually format in, or `APP_TIME_ZONE`.
 *
 * **Every `formatRide*` helper resolves its zone through this and none of them
 * may skip it.** `rides.timezone` is written from a third party's geocode, and
 * ICU's zone table is not Postgres's — `080`'s trigger validates against
 * `pg_timezone_names`, which is the server's, so a name can pass there and still
 * be unknown here. An unknown `timeZone` makes `Intl.DateTimeFormat` **throw a
 * RangeError**, and from inside a ride card that takes down every screen the
 * ride appears on. Falling back is the same answer the column already gives for
 * NULL: we do not know, so use the app's zone.
 *
 * Memoised because these helpers run once per ride per render and constructing a
 * formatter to find out is the expensive half.
 */
const zoneCache = new Map<string, string>()

export function rideZone(zone: string | null | undefined): string {
  if (!zone) return APP_TIME_ZONE

  const known = zoneCache.get(zone)
  if (known) return known

  let resolved = APP_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(0)
    resolved = zone
  } catch {
    // A zone this runtime cannot format in. `resolved` already holds the answer.
  }

  zoneCache.set(zone, resolved)
  return resolved
}

/** What `zone` was offset from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
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
 * Turns a zone-less `datetime-local` value into the UTC instant it names in the
 * ride's own zone — `rides.timezone`, or `APP_TIME_ZONE` when the ride does not
 * carry one (`080`, PD-193).
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
 * Both are pinned by tests, and both are properties of the ZONE rather than of
 * `APP_TIME_ZONE`, so they move with the argument rather than going away.
 *
 * **`zone` is required and `null` is a real answer**, not a default worth
 * omitting. Every caller either knows the ride's zone or knows it does not have
 * one, and a call site that could quietly leave it off is a call site that keeps
 * the bug this parameter exists to fix.
 *
 * **The database is what makes a wrong choice here survivable.** `080`'s
 * `enforce_ride_timezone` shifts `departure_at` whenever a statement moves the
 * zone without moving the instant, so the organizer's wall-clock is held by the
 * one writer that sees both halves. This function decides what the rider MEANT
 * when they typed a time; the trigger decides what happens when the zone
 * arrives afterwards.
 */
export function wallClockToUtc(local: string, zone: string | null): string {
  // `Z` makes the parse deterministic instead of runtime-dependent; the result
  // is then corrected by the zone's real offset rather than trusted.
  const naive = new Date(`${local.length === 16 ? `${local}:00` : local}Z`)
  if (Number.isNaN(naive.getTime())) return new Date(local).toISOString()

  const resolved = rideZone(zone)
  const firstPass = naive.getTime() - zoneOffsetMs(naive, resolved)
  const corrected = naive.getTime() - zoneOffsetMs(new Date(firstPass), resolved)
  return new Date(corrected).toISOString()
}

/**
 * The inverse of `wallClockToUtc` — renders a stored instant back into a
 * `datetime-local` value, as wall-clock in the ride's own zone.
 *
 * An edit screen has a round trip a create screen does not: `CreateRideForm`
 * only ever writes `departure_at`, but `/rides/detail/edit` has to read the
 * stored instant back into the same input first. Rendering the raw UTC instant
 * there (in the browser's own zone, or via a bare `toISOString().slice(0,16)`)
 * would mean saving the form without touching the time field moves the ride by
 * the browser's offset from Amsterdam — a bug an edit screen can produce and a
 * create screen structurally cannot.
 *
 * Parts are pulled with `formatToParts` rather than assembled from
 * `toLocaleString`, matching `zoneOffsetMs`'s own reasoning: a `datetime-local`
 * value has one required shape (`YYYY-MM-DDTHH:mm`) and no locale of its own.
 */
export function formatRideDepartureInput(date: string, zone: string | null): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: rideZone(zone),
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(date))

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  // Same `24` at midnight quirk `zoneOffsetMs` guards against — `datetime-local`
  // rejects an hour of 24, and it means 00 here regardless.
  const hour = find('hour') === '24' ? '00' : find('hour')

  return `${find('year')}-${find('month')}-${find('day')}T${hour}:${find('minute')}`
}

/**
 * What a fresh Create ride form opens on. Product owner, PD-197: "tomorrow at
 * 10h00".
 *
 * **Keep it outside 02:00–03:00.** The date arithmetic below is DST-proof, but
 * the *time* half is only safe because Amsterdam transitions inside that hour:
 * a default of 02:30 would, one Sunday a year, hand `wallClockToUtc` a
 * nonexistent hour and stop round-tripping — the form would open on a value it
 * cannot save back unchanged. Nothing enforces this, so it is written here
 * rather than left to be rediscovered on that Sunday.
 */
const DEFAULT_DEPARTURE_TIME = '10:00'

/**
 * The `datetime-local` value a fresh `Create ride` form opens on — tomorrow at
 * 10:00 (PD-197).
 *
 * **Tomorrow in `APP_TIME_ZONE`, not in the rider's own zone**, for the reason
 * the form states out loud beneath the field: every time on that screen is
 * Amsterdam wall-clock, and `wallClockToUtc` resolves what is typed there
 * against that zone. A rider in Auckland whose own calendar has already rolled
 * over would otherwise seed a date the app then reads as a different day —
 * and one already in the past by Amsterdam's reckoning.
 *
 * **Calendar arithmetic, never instant arithmetic.** The day is incremented on
 * the date *parts* through `Date.UTC`, which rolls months and years for free,
 * so no offset is ever added to a timestamp and the two DST days a year cannot
 * move it. Adding 24h to an instant is the version that breaks on those days.
 *
 * **Call it from an effect, never during render.** `/rides/new` is prerendered
 * at build time; computing "tomorrow" in a component body bakes the *build*
 * date into the static HTML, and riders would then open the form on a default
 * that is however many days stale the deploy is.
 */
export function defaultRideDepartureInput(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)

  // Constructed at UTC midnight purely so `toISOString` reads the same calendar
  // day back out — this is a date, not a moment, and it is never used as one.
  const tomorrow = new Date(Date.UTC(find('year'), find('month') - 1, find('day') + 1))

  return `${tomorrow.toISOString().slice(0, 10)}T${DEFAULT_DEPARTURE_TIME}`
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

const REGIONAL_INDICATOR_A = 0x1f1e6
const LETTER_A = 'A'.charCodeAt(0)

/**
 * `NL` (or `nl`) → `🇳🇱` — the postcard card's flag, PD-279. Two regional
 * indicator symbols, arithmetic rather than an asset, the same trick
 * `src/lib/countries.ts`'s `countryFlag` uses for the profile picker.
 *
 * **Not that function, on purpose.** `taken_country_code` reaches this having
 * already been uppercased once — by `search-places/shape.ts` on the way in,
 * and by `074`'s CHECK on the way to storage — but a card renders whatever a
 * row actually holds, including a stray value from a build that skipped
 * either step. `countryFlag` answers a well-formed alpha-2 code from a picker
 * that only ever offers one; this answers an arbitrary two-character string
 * from the database, so it normalises case itself and answers `null` — never
 * the raw string — for anything that is not two letters once it has, which is
 * what keeps a malformed value from reaching `String.fromCodePoint` and
 * printing as mojibake rather than as no flag at all.
 */
export function countryFlagEmoji(code: string | null | undefined): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return null
  return String.fromCodePoint(
    ...[...upper].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - LETTER_A)
  )
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
export function formatRideDate(date: string, zone: string | null) {
  // Assembled from parts rather than taken whole from `toLocaleDateString`,
  // because en-GB's short date is "Sat 16 Nov" and the design draws a comma
  // after the weekday. The parts still come from Intl, so the weekday and month
  // names stay the locale's — only the punctuation is ours.
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: rideZone(zone),
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
export function formatRideTime(date: string, zone: string | null) {
  return new Date(date).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: rideZone(zone),
  })
}

/**
 * The two-line date block on `RideChip`'s `Collection / Ride` (`2059:5732`)
 * chip — day number over month abbreviation, in the ride's own zone like every
 * other `formatRide*` helper. An object rather than a string, unlike its siblings:
 * the frame draws these as two separate text nodes stacked on top of each
 * other (`Poppins/16/Semibold` over `Poppins/12/Semibold`), not one string a
 * component would have to split back apart.
 */
export function formatRideChipDate(
  date: string,
  zone: string | null
): { day: string; month: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: rideZone(zone),
  }).formatToParts(new Date(date))

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return { day: find('day'), month: find('month').toUpperCase() }
}

/*
 * `formatDate` and `formatDateTime` used to sit here. They are **deleted**, not
 * moved, and the deletion is the fix for a defect this change created.
 *
 * `formatDateTime` had exactly one caller — the club page's ride card — and
 * `formatDate` had none at all. Pinning the three `formatRide*` helpers to
 * APP_TIME_ZONE while leaving that caller unpinned made two screens one tap
 * apart disagree about the same ride: `/clubs/detail` said `06:00 PM` where
 * `/rides/detail` said `20:00`, and past 22:00 UTC they disagreed about the day.
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
 * Rendered in the ride's own zone, never the server's and never the viewer's —
 * see `APP_TIME_ZONE` for why the viewer's is a hydration mismatch rather than a
 * kindness.
 */
export function formatRideDateLong(date: string, zone: string | null) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: rideZone(zone),
  }).formatToParts(new Date(date))

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${find('weekday')}, ${find('day')} ${find('month')}`
}

/**
 * Which calendar day an instant falls on in `zone`, as a count of days since the
 * epoch — the unit `formatRideCardDay` subtracts.
 *
 * **A day *number*, not a duration.** "Tomorrow" is a calendar fact, not
 * twenty-four hours: a ride leaving at 08:00 tomorrow is 14 hours away at 18:00
 * tonight and 26 hours away at 06:00 this morning, and it is "Tomorrow" in both.
 * Dividing an instant difference by 86,400,000 answers the wrong question and is
 * wrong twice a year besides, on the two days that are 23 and 25 hours long.
 *
 * Assembled from `Intl` parts rather than from an offset calculation, the same
 * trick `rideZoneDayKey` uses and for the same reason: the zone's own rules —
 * DST, historical offsets, the half-hour zones — are ICU's to apply, not ours.
 */
function zoneDayNumber(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)

  // `Date.UTC` on the zone's own calendar parts, so the result is a plain day
  // index with no offset left in it — two of these subtract to a day count.
  return Math.floor(Date.UTC(find('year'), find('month') - 1, find('day')) / 86_400_000)
}

/**
 * The ride card's day, in the words a rider actually uses — `Today`,
 * `Tomorrow`, `This Wednesday`, `Next Wednesday`, and `SAT, 16 NOV` beyond
 * that (PD-340).
 *
 * Product owner, 2026-08-28: *"'smart date' for eg. \"This Wednesday at 14h\""*.
 * The card used to draw `formatRideDate` alone, which makes the rider do
 * arithmetic the app already has the numbers for: `SAT, 16 NOV` only means
 * something to someone who knows what today is.
 *
 * ## The bands, and where each boundary sits
 *
 * | Days ahead, in the ride's own zone | Reads |
 * |---|---|
 * | `-1` | `Yesterday` |
 * | `0` | `Today` |
 * | `1` | `Tomorrow` |
 * | `2`–`6` | `This ⟨weekday⟩` |
 * | `7`–`13` | `Next ⟨weekday⟩` |
 * | anything else, past or future | `formatRideDate` — `SAT, 16 NOV` |
 *
 * **`This`/`Next` is a decision, not a convention, because English has none.**
 * "This Wednesday" said on a Monday means two days away to most people and next
 * week's to some; the split here is *the next occurrence* versus *the one after
 * it*, which is the reading that never leaves a rider with two candidate dates.
 * It is safe precisely because the two bands cannot overlap: at 7–13 days the
 * nearer occurrence has already been named `This`, so `Next` can only mean the
 * far one.
 *
 * **Past days beyond yesterday get the plain date and that is deliberate.**
 * `RideCard` draws past rides too — the "Went" pill exists for them — and
 * `Last Wednesday` competes with `Yesterday` for the same week in a way
 * nothing on the card resolves. A date is unambiguous, and history is read
 * rather than planned against.
 *
 * ## The zone is the ride's, for both halves of the comparison
 *
 * `now` is bucketed in `rideZone(zone)` too, never in the runtime's zone. Every
 * other thing this card says about the ride is its meeting point's wall clock
 * (`080`, PD-193), so a card reading `Tomorrow · 09:00` must mean nine
 * tomorrow *there*. Bucketing `now` locally would let a rider in Lisbon see
 * `Today · 01:00` for a ride that has already left Berlin.
 *
 * `now` is injectable for the tests, which is the only way to assert a band:
 * `vitest.config.ts` pins `TZ=UTC`, so a fixed clock is what distinguishes a
 * real zone lookup from a string comparison that happens to agree.
 */
export function formatRideCardDay(date: string, zone: string | null, now: Date = new Date()) {
  const resolved = rideZone(zone)
  const departure = new Date(date)
  const days = zoneDayNumber(departure, resolved) - zoneDayNumber(now, resolved)

  if (days === -1) return 'Yesterday'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 0 || days > 13) return formatRideDate(date, zone)

  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: resolved,
  }).format(departure)

  return `${days < 7 ? 'This' : 'Next'} ${weekday}`
}

/**
 * How far a ride's meeting point is from the rider — `12 km away` (PD-340).
 *
 * **Not `formatRide*`, deliberately.** That prefix carries a rule in
 * `CLAUDE.md` — every one of them takes `rides.timezone` as a required argument
 * — and this formatter has no instant in it at all, so joining the family by
 * name would make that rule read as false at a glance and invite the next
 * session to "fix" it by adding a zone parameter nothing could use. It is still
 * named for what it serves: the distance to a ride's start, on the card and on
 * the detail's location row.
 *
 * Takes kilometres, which is what `distanceKm` returns and what
 * `RideListItem.distance_km` carries; a caller with `undefined` has no distance
 * to draw and must render nothing rather than call this with a fallback.
 *
 * **Whole kilometres, and never a decimal.** The rider's own position is
 * rounded to two decimal places — roughly a kilometre — before it reaches any
 * distance calculation (PD-151), and the meeting point's own coordinate is a
 * geocode of a free-text address. `11.6 km away` would render four significant
 * figures onto an input good for two, which is the "unlabelled guess passing as
 * a known value" this repo refuses everywhere else.
 *
 * **`Under 1 km away` rather than `0 km away`** for anything below a kilometre.
 * Rounding to zero states something false — the ride is not *here* — and it is
 * the one bucket where the ±1 km input error is the whole of the number.
 *
 * No further bucketing above that: the error is ~1 km at every distance, so the
 * kilometre digit is exactly as honest at 400 km as at 4, and rounding a long
 * distance to the nearest ten would be a display preference with nothing behind
 * it.
 *
 * `en-GB` grouping, so a genuinely distant ride reads `1,240 km away` rather
 * than as a raw integer — the same locale every other `formatRide*` helper uses.
 */
export function formatStartDistance(km: number) {
  if (!Number.isFinite(km) || km < 0) return null
  if (km < 1) return 'Under 1 km away'
  return `${Math.round(km).toLocaleString('en-GB')} km away`
}

/**
 * The same distance for `RideChip`, the club detail's 200px rides strip —
 * `12 km`, `<1 km`.
 *
 * **A second formatter rather than a flag on the one above, which is this
 * file's own rule**: each screen writes what it draws, and a `compact` boolean
 * would read as a preference at the call site when it is really "which screen
 * is this". `formatRideDate` and `formatRideDateLong` are the same pair for the
 * same reason.
 *
 * **The chip genuinely has no room for the long form, and that is arithmetic
 * rather than taste.** The chip is 200px with `p-1`, a 48px date block and a
 * 12px gap, leaving 132px for its text column. `14:00 · 12 km away` is 18
 * characters — about 131px at `text-sm` — so the long form truncates the moment
 * the distance reaches three digits.
 *
 * **What it truncates is the distance, not the time**, and it is worth being
 * exact because the obvious fear is the other way round: `RideChip` puts
 * `truncate` on the span wrapping both, and `text-overflow: ellipsis` clips the
 * tail, so the time — first, and about 35px of the 132 — can never be the
 * casualty.
 *
 * The overflow is a character or two rather than a collapse: at the same 7.3px
 * per character, `14:00 · 123 km away` is ~138px against 132, so it renders
 * about `14:00 · 123 km aw…`. **That is still the reason the long form is
 * refused** — a clause that trails off mid-word says less than a complete
 * `123 km` — but it is not the departure time that is lost, and stating it as a
 * near-total truncation would overstate a real cost into an unreachable one.
 *
 * `<1 km` rather than `Under 1 km` for the same reason, and it is the one place
 * in the app that abbreviates it. The rounding is shared, so the two forms can
 * never disagree about the number.
 */
export function formatStartDistanceShort(km: number) {
  if (!Number.isFinite(km) || km < 0) return null
  if (km < 1) return '<1 km'
  return `${Math.round(km).toLocaleString('en-GB')} km`
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
 * The instant `APP_TIME_ZONE`'s current calendar day began — midnight, as UTC.
 *
 * This is where a ride stops being upcoming and becomes a previous ride, and it
 * is deliberately **not** `now`. A ride that left at 15:00 is still today's
 * ride at 23:00: dropping it out of the list the moment it departs takes it off
 * the screen of every rider still on it, and filing it under "Past rides"
 * the same evening reads as a day that is already over. It moves at midnight,
 * once, for everyone.
 *
 * **Pinned to `APP_TIME_ZONE`, and this is the one ride surface that cannot
 * follow `rides.timezone`.** The boundary is a single instant handed to a
 * `gte` in one query, so it has to be one clock for the whole list; there is no
 * per-row zone available to a predicate the rows have not been read for yet.
 *
 * The cost is a known and bounded one, stated rather than left to be
 * rediscovered: a ride whose own zone is far from `APP_TIME_ZONE` can sit on the
 * far side of this boundary from the date `formatRideDate` draws beside it, for
 * the few hours a day the two zones disagree about. That is a smaller error than
 * the alternative — reading every ride to decide which day it is on — and it is
 * the same shape as the fixed zone this whole surface used to have.
 *
 * Built from the two halves that already exist — the day in that zone, then the
 * instant that wall-clock names — so the DST correction lives in exactly one
 * place. Midnight is never the skipped hour in `APP_TIME_ZONE` (both
 * transitions happen at 02:00 or 03:00 local), so the ambiguous-hour caveats on
 * `wallClockToUtc` do not reach this caller.
 */
export function rideDayStartUtc(now: number = Date.now()): string {
  // `null` is the zone, not a missing argument: this boundary is deliberately
  // the app's clock rather than any one ride's — see above.
  return wallClockToUtc(`${rideZoneDayKey(new Date(now).toISOString())}T00:00`, null)
}

/**
 * A chat's day separator — `Today`, `Yesterday`, or `Sat, 16 Nov`.
 *
 * **Named for the surface rather than for the ride since `081`** (PD-307): both
 * the ride chat and a club thread draw this exact separator, so a second
 * function with the same body would be this file's per-screen rule read as its
 * letter against its reason — the same argument the bubble clock below already
 * makes for reusing `formatRideTime`. A club thread has no timezone at all,
 * so its callers pass `null` and mean it.
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
export function formatChatMessageDay(date: string, now: Date = new Date()): string {
  const key = rideZoneDayKey(date)
  // Uppercased to match `formatRideDate`, which is the branch below and which
  // the design uppercases on the ride card. Mixing `Today` with `SAT, 16 NOV`
  // in one column of separators reads as two different components.
  if (key === rideZoneDayKey(now.toISOString())) return 'TODAY'

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (key === rideZoneDayKey(yesterday.toISOString())) return 'YESTERDAY'

  // `null`, not the ride's zone: this is a CHAT day separator, and the whole
  // thread has to split on one clock or two riders see the divider in different
  // places. `rideZoneDayKey` above already decided that clock.
  return formatRideDate(date, null)
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

/**
 * `2m` / `23m` / `1d` / `2w` — the compact stamp on line one of a notification
 * row (`Inbox - Notifications`, measured 2026-08-07). **Not `formatRelativeTime`**:
 * that formatter produces prose ("2 minutes ago") for the postcard byline it was
 * named for, and per this file's own rule a formatter is named for the screen
 * it serves rather than shared, because each design draws a genuinely different
 * shape. This is that screen's own.
 *
 * Needs no zone, like `formatRelativeTime` — it measures the distance between
 * two instants, and that distance is the same number of seconds everywhere.
 *
 * Floors rather than rounds (`23m` reads as "at least 23, not yet 24" rather
 * than "closest to 23"), which is the usual convention for a compact stamp and
 * keeps it monotonic as time passes rather than jumping a unit early.
 *
 * The design draws `2m` through `2w` and nothing older — `Inbox - Notifications`'s
 * own "All time" section only reaches two weeks in its mocked data. Months and
 * years are **not measured**, only extended from the same table by the same
 * rule the design already establishes (a fixed unit per order of magnitude);
 * logged in `docs/FIGMA-FIDELITY-TODO.md` as inferred rather than read.
 */
export function formatNotificationStamp(date: string, now: Date = new Date()) {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(date).getTime()) / 1000))
  if (seconds < 60) return 'now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`

  // Gate on `days`, never on the derived `months`. The two units disagree
  // about where a year starts — `days / 30` reaches 12 on day 360 while
  // `days / 365` is still 0 until day 365 — so `months < 12` handed days
  // 360–364 to the years branch, which drew `0y`. Clamping the month count
  // keeps the sequence monotonic across the seam: 359d and 364d both read
  // `11mo`, and `1y` starts on day 365.
  if (days < 365) return `${Math.min(Math.floor(days / 30), 11)}mo`

  return `${Math.floor(days / 365)}y`
}

/**
 * Which of `Inbox - Notifications`'s four sections a row's `created_at` falls
 * into — `Today` / `Yesterday` / `This week` / `All time`.
 *
 * Boundaries resolve in `APP_TIME_ZONE` via `rideZoneDayKey`, matching every
 * other day boundary in the app and for the same interim reason: the
 * prerender pass runs on Vercel, so a boundary computed in the runtime's own
 * zone would render one section into the HTML and another on hydration.
 *
 * `key` strings are `YYYY-MM-DD`, so lexicographic comparison is chronological
 * comparison — no arithmetic on the offset needed once the zone conversion is
 * done.
 *
 * **"This week" is a 7-day rolling window, not a calendar week**, and that is
 * inferred rather than measured: the design draws no boundary at all, only
 * four labelled sections with mocked rows that happen to span `2m` through
 * `2w`. A calendar week would move a Monday notification into `All time` on
 * Tuesday with nothing about the notification having changed, which is a
 * worse property than an arbitrary-looking rolling window. Logged in
 * `docs/FIGMA-FIDELITY-TODO.md` rather than passed off as read from the frame.
 */
export function notificationSection(
  date: string,
  now: Date = new Date()
): 'Today' | 'Yesterday' | 'This week' | 'All time' {
  const key = rideZoneDayKey(date)
  const todayKey = rideZoneDayKey(now.toISOString())
  if (key === todayKey) return 'Today'

  const yesterdayKey = rideZoneDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
  if (key === yesterdayKey) return 'Yesterday'

  const weekAgoKey = rideZoneDayKey(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
  if (key >= weekAgoKey) return 'This week'

  return 'All time'
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
