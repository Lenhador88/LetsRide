import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
