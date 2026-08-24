import type { DeviceLocationPermission, RiderLocation } from '@/lib/location/rider-location'

/**
 * What, if anything, a screen should draw to ask a rider for their device
 * location — PD-170.
 *
 * ## Why this is a pure function rather than logic inside the component
 *
 * Same reason `resolveComboboxKey` was split out of `PlaceSearchField`: the
 * decision has eight inputs' worth of states and exactly one of them is a
 * rendering question. Split, every state gets a named test; folded into the
 * component, only the two states a `renderToStaticMarkup` pass can reach do.
 *
 * ## The three answers
 *
 * - **`hidden`** — draw nothing at all. The default, and the answer for every
 *   state where a row would be noise or a lie.
 * - **`ask`** — the device will show its permission dialog if something asks.
 *   This is the state the priming sheet exists for: explain first, and let the
 *   rider spend the one prompt deliberately.
 * - **`blocked`** — the device has already refused, and on iOS that refusal is
 *   one-way from inside the app. The row still draws, but it opens the sheet's
 *   *denied* copy: what is lost, and where to switch it back on.
 */
export type LocationPrimingState = 'hidden' | 'ask' | 'blocked'

export function locationPrimingState({
  permission,
  position,
}: {
  /** `undefined` until the Permissions API has answered — see below. */
  permission: DeviceLocationPermission | undefined
  /**
   * What `resolveRiderLocation()` came back with. **`undefined` is "not
   * settled yet" and `null` is a decided "nowhere"** — the same distinction
   * every detail screen in this app makes a 404 out of, and here the cost of
   * confusing them is a row that flashes onto the screen and then vanishes on
   * every single load.
   */
  position: RiderLocation | null | undefined
}): LocationPrimingState {
  // **Nothing renders until BOTH inputs are decided.** A row drawn against an
  // unread permission is drawn against a guess, and the guess is wrong for
  // exactly the rider who already granted — who would then watch an offer to
  // enable something they enabled months ago appear and disappear.
  if (permission === undefined || position === undefined) return 'hidden'

  // Already granted: there is no question left to ask. A `null` position in
  // this state is a GPS acquisition that failed or timed out, which is a
  // different problem with a different answer, and a permission sheet is the
  // wrong response to it.
  if (permission === 'granted') return 'hidden'

  // No geolocation on this platform at all. There is nothing to offer.
  if (permission === 'unavailable') return 'hidden'

  // **A rider who already has a position is not nagged, whatever its source.**
  // The near-you strip and the club distances are working for them — from the
  // geocoded onboarding city rather than the device, so less precisely, but
  // working. Offering an upgrade there adds a second location row to a screen
  // that already has one, permanently, for precision the rider never asked
  // for. The row is for the state where the feature is otherwise INVISIBLE.
  //
  // The cost, stated rather than hidden: a rider with a geocodable profile
  // city is never asked, so on a device build they keep the approximate
  // answer. That is the right trade at one row per screen; reopen it if a
  // feature ever needs a real fix rather than a bias.
  if (position !== null) return 'hidden'

  return permission === 'denied' ? 'blocked' : 'ask'
}
