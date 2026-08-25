/**
 * Great-circle distance, for "clubs near you" (PD-259).
 *
 * ## Why this is here rather than in the database
 *
 * `getExploreClubs` already reads a bounded page — the newest
 * `CLUBS_PAGE_SIZE` public clubs — and then filters it in JS, for a reason its
 * own comment gives. Sorting that same page by distance costs one `Math` call
 * per row and needs no second round trip, no PostGIS, and no index on a table
 * holding tens of rows.
 *
 * **The trigger for moving it into SQL is a club count that outgrows the
 * page**, at which point the question changes from "sort these fifty" to "find
 * the nearest fifty of five thousand", and no client-side helper can answer
 * that. `066` §4 says the same from the schema's side and names the index that
 * would arrive with it.
 *
 * ## Haversine, not equirectangular
 *
 * The cheaper flat-earth approximation is genuinely fine over the Netherlands,
 * and that is exactly why it is not used: nothing in the schema confines a club
 * to one country, `places.country` is `'NL'` on every row *today*, and an
 * approximation whose error grows with latitude and separation is the kind of
 * thing that stays correct until the first club in Norway. Haversine is
 * accurate everywhere for a few floating-point operations more.
 *
 * It models the Earth as a sphere, so it carries up to ~0.5% error against the
 * true ellipsoid — around 500 m in 100 km. For "is this club near me" that is
 * far below the precision of the inputs: a rider's own position is rounded to
 * two decimal places (~1 km) before it ever reaches here.
 */

/**
 * Mean Earth radius in kilometres (IUGG). Not the equatorial radius (6,378.137)
 * — the mean is the right one for a spherical approximation, and using the
 * equatorial value would bias every distance long by about 0.17%.
 */
const EARTH_RADIUS_KM = 6371.0088

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

export type Coordinates = { lat: number; lon: number }

/**
 * Kilometres between two points, or `null` if either is not a usable
 * coordinate.
 *
 * **`null` rather than a thrown error or a sentinel number.** Both inputs come
 * from places this module does not control — a rider's device, and four
 * database columns that are nullable by design — so "no answer" is an ordinary
 * outcome rather than a fault. A sentinel like `Infinity` would sort correctly
 * and then render as a distance; `null` cannot be mistaken for one.
 *
 * `NaN` and infinities are refused explicitly. `Math.cos(NaN)` is `NaN`, which
 * propagates silently through every comparison as `false` — a club with a
 * corrupt coordinate would simply never appear near anything, with nothing
 * anywhere saying why.
 */
export function distanceKm(a: Coordinates | null, b: Coordinates | null): number | null {
  if (!a || !b) return null
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return null
  if (!Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null

  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2

  // `atan2(√h, √(1−h))` rather than `asin(√h)`: the two agree everywhere except
  // near antipodal points, where floating-point error can push `h` a hair above
  // 1 and `asin` returns NaN. Nothing in this app is antipodal today; the
  // version that cannot return NaN costs the same.
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * How far a club **or a ride** can be and still count as "near you" — the
 * radius behind the Explore strip's `near <town>` wording and behind which
 * clubs sort first, and since PD-260 behind the rides list's near-you filter.
 *
 * **100 km is a decision, not a measurement, and it is a MOTORCYCLE number.**
 * A rider will happily ride an hour and a half to meet a club; the same radius
 * would be absurd for a walking-distance product. It is deliberately generous:
 * the failure this bounds is a club in another country reading as local, not a
 * club two towns over being excluded.
 *
 * ## One radius for two questions, and the asymmetry is real
 *
 * PD-260 gave this constant a second caller, and the case is genuinely weaker
 * there: you *join* a club once and ride to it when you feel like it, whereas
 * a ride is somewhere you have to physically be at a stated time. 95 km is a
 * different proposition for the two.
 *
 * It stays one number anyway, for two reasons rather than by inheritance.
 * **There is one "near you" in this app**, said in the same words on two tabs
 * by the same-looking row, and a rider who learns what it means on Clubs must
 * not have to relearn it on Rides. And on Rides the number does not stand
 * alone: every card under the filter draws its own `meeting_point`, so a ride
 * in the wrong direction announces itself by name, where a club in the Explore
 * list does not.
 *
 * **Splitting it is a product decision, not a refactor** — it needs a second
 * number chosen against something, and the honest trigger is a rider saying a
 * result was too far, or a ride card gaining a rendered distance that makes the
 * boundary visible. Neither has happened.
 *
 * Nothing hard-fails at the boundary — a club just past it still appears on
 * Explore, lower down, and a ride just past it is still on the unfiltered list
 * the strip toggles back to. That is what makes the number safe to change
 * later.
 */
export const NEARBY_RADIUS_KM = 100

/** Is this club or ride close enough to be worth calling "near you"? */
export function isNearby(distance: number | null | undefined): boolean {
  return distance !== null && distance !== undefined && distance <= NEARBY_RADIUS_KM
}
