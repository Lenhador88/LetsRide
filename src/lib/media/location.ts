/**
 * What a photo's location is allowed to be, and the rounding that makes
 * `Region` mean something.
 *
 * The rule this file exists to hold: **the mode decides what is UPLOADED, not
 * what is displayed.** Storing the precise value with a "do not show it" flag
 * would put the exact spot on the server for every photo and make one policy
 * mistake a disclosure. Rounding here, in the browser, before the request, means
 * there is nothing to disclose.
 *
 * The direct consequence, and the reason the default is `hide`: a rider can
 * always make a photo vaguer and never sharper. Precision discarded on the
 * device is gone.
 */

/**
 * The three buttons the composer draws, in order.
 *
 * `hide` is not a stored value — it is the *absence* of one — which is why the
 * column that records this is nullable and only ever holds the other two.
 */
export type PhotoLocationMode = 'hide' | 'region' | 'precise'

/** What the composer opens on, every time. Never remembered between uploads. */
export const DEFAULT_PHOTO_LOCATION_MODE: PhotoLocationMode = 'hide'

/**
 * Decimal places `Region` keeps. Two is ~1.1 km of latitude, and ~0.7 km of
 * longitude at Dutch latitudes — a neighbourhood.
 *
 * **Three was the tempting number and it is wrong here.** ~110 m is still a
 * street, and on a rural road — which is most of where this app's photos get
 * taken — a street is a house. The design's own hint line commits to this
 * reading: "Rounded to about a kilometre."
 */
export const REGION_DECIMAL_PLACES = 2

/**
 * Rounds one coordinate to the region grid.
 *
 * `Math.round(v * 100) / 100` rather than `toFixed` + `parseFloat`: the result
 * has to be a number the database's CHECK accepts, and that CHECK asks whether
 * the stored value **is already at two decimal places**
 * (`v = round(v::numeric, 2)::float8`), not whether it equals Postgres's own
 * rounding of some original. Any `integer / 100` satisfies it, so the two
 * languages disagreeing on a halfway case — JS gives 4.89 for 4.895, Postgres's
 * numeric round gives 4.90 — is not a divergence this can fail on. Verified
 * against the DEV database rather than reasoned about.
 */
export function roundToRegion(value: number): number {
  const factor = 10 ** REGION_DECIMAL_PLACES
  return Math.round(value * factor) / factor
}

/**
 * What actually travels with the postcard, for a mode and the coordinate the
 * photo carried.
 *
 * A single function rather than a branch at the call site, because the one thing
 * that must never happen is a path where `precise` is stored under a `region`
 * marker. Here the marker and the value are produced together or not at all.
 */
export type PhotoLocation = {
  latitude: number | null
  longitude: number | null
  /** `null` for `hide`, and for a photo that carried no location to begin with. */
  precision: 'region' | 'precise' | null
}

export const NO_PHOTO_LOCATION: PhotoLocation = {
  latitude: null,
  longitude: null,
  precision: null,
}

export function resolvePhotoLocation(
  mode: PhotoLocationMode,
  coordinates: { latitude: number | null; longitude: number | null }
): PhotoLocation {
  const { latitude, longitude } = coordinates
  // Both or neither, always — the database CHECK refuses a half pair, and a
  // latitude with no longitude is not a location.
  if (mode === 'hide' || latitude === null || longitude === null) return NO_PHOTO_LOCATION

  if (mode === 'region') {
    return {
      latitude: roundToRegion(latitude),
      longitude: roundToRegion(longitude),
      precision: 'region',
    }
  }

  return { latitude, longitude, precision: 'precise' }
}
