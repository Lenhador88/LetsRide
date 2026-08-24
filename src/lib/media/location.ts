/**
 * What a postcard's location is allowed to be, and the rounding that keeps the
 * middle option honest.
 *
 * The rule this file exists to hold: **the mode decides what is UPLOADED, not
 * what is displayed.** Storing the precise value with a "do not show it" flag
 * would put the exact spot on the server for every photo and make one policy
 * mistake a disclosure. Resolving it here, in the browser, before the request is
 * built, means there is nothing to disclose.
 *
 * The direct consequence, and the reason the default is `hide`: a rider can
 * always make a postcard vaguer and never sharper. Precision discarded on the
 * device is gone.
 *
 * ## What changed, and the sentence that carries it
 *
 * The middle mode used to be `region` — the photo's own coordinate rounded to a
 * ~1 km cell, and described to the rider as "about a kilometre". It is now a
 * **place the rider names**, prefilled from the photo where that is possible and
 * typed where it is not. The rounding survives, and its job inverted: it was the
 * *promise* and it is now the *mechanism*. A named place is what the rider reads;
 * the 2dp coordinate under it is what stops the schema describing a driveway as
 * a city.
 *
 * `region` is gone from this file and still legal in the column — one row on DEV
 * carries it. The client stops writing it; nothing backfills it.
 *
 * **The rider-facing label for the middle mode is `Region` and the marker is
 * still `place`** (2026-08-20). The two words are deliberately different, for
 * exactly the reason in the paragraph above: `'region'` already means `064`'s
 * rounded coordinate in this column.
 */

/**
 * The three buttons the composer draws, in order.
 *
 * `hide` is not a stored value — it is the *absence* of one — which is why every
 * column that records this is nullable and only ever holds the other two.
 */
export type PhotoLocationMode = 'hide' | 'place' | 'precise'

/** What the composer opens on, every time. Never remembered between uploads. */
export const DEFAULT_PHOTO_LOCATION_MODE: PhotoLocationMode = 'hide'

/**
 * Decimal places a coarse location keeps. Two is ~1.1 km of latitude, and
 * ~0.7 km of longitude at Dutch latitudes — a neighbourhood.
 *
 * **Three was the tempting number and it is wrong here.** ~110 m is still a
 * street, and on a rural road — which is most of where this app's photos get
 * taken — a street is a house.
 *
 * **It bounds the NAMED place too, not only the retired rounding**, and that is
 * the whole reason it survived the rename. The typeahead is a geocoder: it
 * returns streets and buildings, so a rider can name their own address in a
 * field labelled `Region`. Rounding what is stored means the name is as specific
 * as the rider chose to be and the *coordinate* never is.
 */
export const COARSE_DECIMAL_PLACES = 2

/**
 * Rounds one coordinate to the coarse grid.
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
export function roundToCoarseGrid(value: number): number {
  const factor = 10 ** COARSE_DECIMAL_PLACES
  return Math.round(value * factor) / factor
}

/**
 * A place the rider has named — picked from the typeahead, or typed and never
 * picked.
 *
 * **A typed name with no coordinate is a first-class state, not a degraded
 * one.** The rider may be offline, may have spent their lookup ceiling, or may
 * simply know where they were; refusing the name because no pin came with it
 * would make the typeahead a gate, which is the opposite of what it is for.
 */
export type NamedPlace = {
  name: string
  lat: number | null
  lon: number | null
}

/**
 * **The provider's own id for a picked place is deliberately NOT here, and not
 * stored.** It looked like free provenance and it is a precision backdoor: a
 * `geoapify:` id is a pointer a place-details lookup resolves back to the
 * picked feature's exact geometry, so storing one beside a 2dp coordinate would
 * hand any reader of the row the precision the rounding exists to remove. It
 * Found by the proposal's review pass, 2026-08-20.
 *
 * **The second half of that argument is spent and the first is what stands.**
 * It also said the id "was bought for nothing, too — nothing in the app renders
 * a postcard's location", which stopped being true on 2026-08-24 when PD-279
 * put the place name on the card. The precision backdoor is decisive on its own
 * and is the reason to keep refusing a provider id; do not restate the
 * rendering clause when quoting this.
 */

/**
 * What actually travels with the postcard.
 *
 * **One coordinate pair, and `precision` says whose it is.** A second pair —
 * the town's beside the photo's — would be the "stored but hidden" state this
 * file exists to make unrepresentable: the precise value would sit on the server
 * for every postcard whose rider chose the town, and RLS is row-level, so any
 * reader of the row reads it.
 */
export type PhotoLocation = {
  latitude: number | null
  longitude: number | null
  /** `null` for `hide`, and for a mode with nothing to say. */
  precision: 'place' | 'precise' | null
  placeName: string | null
}

export const NO_PHOTO_LOCATION: PhotoLocation = {
  latitude: null,
  longitude: null,
  precision: null,
  placeName: null,
}

/**
 * The five legal shapes, produced in one place.
 *
 * A single function rather than a branch at the call site, because the one thing
 * that must never happen is a path where a town's centroid is stored under the
 * `precise` marker, or the photo's own fix under `place`. Here the marker and
 * the value are produced together or not at all, and `072`'s coupling constraint
 * refuses every combination this function cannot emit.
 */
export function resolvePhotoLocation(
  mode: PhotoLocationMode,
  capture: { latitude: number | null; longitude: number | null },
  place: NamedPlace | null
): PhotoLocation {
  if (mode === 'hide') return NO_PHOTO_LOCATION

  if (mode === 'place') {
    const name = place?.name.trim()
    // Selecting the mode and naming nothing is not an error and not a partial
    // row — it is the same answer as `hide`, which is what arm 1 of the
    // constraint says. The alternative, refusing the submit, would block a
    // postcard over a field the rider never had to fill in.
    if (!name) return NO_PHOTO_LOCATION

    // Both or neither, always — the CHECK refuses a half pair, and a latitude
    // with no longitude is not a location.
    const hasPin = place!.lat !== null && place!.lon !== null
    return {
      latitude: hasPin ? roundToCoarseGrid(place!.lat!) : null,
      longitude: hasPin ? roundToCoarseGrid(place!.lon!) : null,
      precision: 'place',
      placeName: name,
    }
  }

  // `precise` has TWO sources and the photo's own fix is only the first.
  //
  // Product owner, 2026-08-20: the option came back because a photo that
  // carries no fix — every HEIC before this session, and anything through a
  // share sheet — removed it from the screen entirely, which read as a lost
  // feature rather than as a photo that knew nothing. So a place the rider
  // PICKED is the second source: they named a spot and asked for it exactly,
  // which is a coherent request and the only other exact coordinate on this
  // screen.
  const { latitude, longitude } = capture
  if (latitude !== null && longitude !== null) {
    return {
      latitude,
      longitude,
      precision: 'precise',
      // The name rides along as a LABEL for a coordinate that did not come from
      // it, so the two may disagree — deliberately, and cosmetically. It is a
      // caption, not evidence.
      placeName: place?.name.trim() || null,
    }
  }

  // **A PICKED place only — never a typed one.** A typed name has no coordinate
  // at all, so there is nothing to be exact about; emitting the name under
  // `precise` would mark a row as carrying an exact spot that it does not have.
  // That falls through to the `hide`-shaped answer below, which is arm 1 and
  // exactly what a rider who has named nothing should get.
  const name = place?.name.trim()
  if (place && place.lat !== null && place.lon !== null) {
    return {
      latitude: place.lat,
      longitude: place.lon,
      precision: 'precise',
      placeName: name || null,
    }
  }

  return NO_PHOTO_LOCATION
}
