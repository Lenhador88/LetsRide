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
 * Applies to the three `formatRide*` helpers only. `formatDate`/`formatDateTime`
 * are untouched here — they carry a separate known `en-US` bug and the two
 * changes should not be tangled.
 */
export const APP_TIME_ZONE = 'Europe/Amsterdam'

/**
 * A Google Maps **directions** link to a free-text destination.
 *
 * `maps/dir/?api=1&destination=…`, not `maps/search/?api=1&query=…`. The search
 * endpoint drops a pin and stops there — which is what riders reported: tapping
 * the map "only highlights the location". `dir` with a `destination` and no
 * `origin` makes Google route from wherever the rider currently is, which is the
 * thing the tap was always meant to do.
 *
 * `travelmode=driving` because this is a motorcycle app. Google's `two-wheeler`
 * mode exists but is only served in a handful of countries and falls back
 * unpredictably elsewhere, so the honest default is the one that resolves the
 * same way everywhere.
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
 * Its own formatter rather than `formatDate` because the design gives this one a
 * distinct shape: day first, short month, no weekday, sized to sit in the corner
 * of a photo. `en-GB` gives that day-first order; the design's lowercase month
 * ("19 nov 2024") is Dutch, which is the locale its mock content is written in
 * rather than a choice about the app's.
 *
 * This deliberately does not touch the `en-US` hardcoding in `formatDate` /
 * `formatDateTime` / `formatRelativeTime`. That is a known bug for a European
 * rider app and the three have to move together, which is not this change.
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

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(date: string) {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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
 * Locale is hardcoded `en-US` to match formatDate/formatDateTime. That is the
 * same known bug they carry for a European rider app, not a new decision —
 * fixing it means fixing all three together.
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
