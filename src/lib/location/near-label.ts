import { localityOf } from '@/lib/countries'
import type { RiderLocation } from '@/lib/location/rider-location'

/**
 * What to call the place a distance was measured FROM — `near Utrecht`, `near
 * you`, or nothing at all.
 *
 * ## The defect this exists to make unrepresentable
 *
 * The Explore strip names the rider's **profile city** while `distance_km` is
 * measured from `resolveRiderLocation()`, whose *first* source is the device
 * fix and whose second is that city. Those are the same place for most riders
 * and not for the one who matters: a rider whose profile says `Utrecht`, who
 * has granted location, and who is in Maastricht gets clubs within 100 km of
 * **Maastricht** under the words `near Utrecht`. Every one of them is a club
 * that is not near Utrecht, and nothing on the screen says so.
 *
 * So the rule is: **the name must come from the same source as the number.**
 * `RiderLocation.source` already carries which one answered; this is the only
 * thing that reads it, and that is the point.
 *
 * - `source: 'profile'` — the position IS the geocoded profile city, so naming
 *   that city is exactly right.
 * - `source: 'device'` — the position is a GPS fix and this app stores no
 *   reverse geocode for it, so there is no town name to say. `near you` is
 *   true, short, and needs no lookup. Reverse-geocoding the fix to name the
 *   town would be a second `places` round trip per screen for one word.
 * - no position — no claim of proximity at all.
 */
export type NearLabel = { name: string } | null

export function nearLabel(
  position: RiderLocation | null | undefined,
  profileCity: string | null | undefined
): NearLabel {
  if (!position) return null

  if (position.source === 'device') return { name: 'you' }

  // `localityOf` rather than the raw column: `profiles.location` is free text
  // and riders type `Amsterdam`, `Amsterdam, Netherlands`, `Amsterdam, NL` and
  // `Hoorn Netherlands` — all four are in the database. It also answers null
  // for the string of spaces `018` permits, so this never renders `near` and a
  // gap.
  const locality = localityOf(profileCity)

  // A profile-sourced position whose city will not reduce to a locality is a
  // real state — the geocode succeeded on a string `localityOf` declines to
  // shorten. `near you` is still true of it, and truer than falling back to no
  // claim at all when the distances on screen are real.
  return { name: locality ?? 'you' }
}
