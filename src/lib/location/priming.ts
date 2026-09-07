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
 * ## The five answers
 *
 * - **`hidden`** — draw nothing at all. The default, and the answer for every
 *   state where a row would be noise or a lie.
 * - **`ask`** — the device will show its permission dialog if something asks.
 *   This is the state the priming sheet exists for: explain first, and let the
 *   rider spend the one prompt deliberately.
 * - **`blocked`** — the device has already refused, and on iOS that refusal is
 *   one-way from inside the app. The row still draws, but it opens the sheet's
 *   *denied* copy: what is lost, where to switch it back on, and — since
 *   PD-419 — the town question, which is the route out that does not go through
 *   the Settings app.
 * - **`town`** — there is no device to ask at all and no position either, so the
 *   device story never starts. The row goes straight to the town question.
 * - **`refine`** — the rider HAS a position, from their town rather than the
 *   device, and the device could still be asked. A quiet row offers the upgrade.
 *
 * ## PD-419 reopened the "never nag a rider who has a position" rule
 *
 * This function used to return `hidden` for **any** non-null position, and said
 * so with its own escape clause: *"reopen it if a feature ever needs a real fix
 * rather than a bias."* PD-419 is that reopening, and what changed is the
 * screen rather than the appetite. The rule was written when the row was a
 * 56px card offering to enable something, which is a genuine nag at one per
 * screen. `refine` is a line of text saying **where the distances on screen are
 * measured from**, with the upgrade attached to it — so a rider whose profile
 * says Utrecht and who is in Maastricht can now see why every distance looks
 * wrong, which was previously unanswerable from inside the app.
 *
 * **`refine` is still narrow, and the two exclusions are what keep it honest:**
 * a device-sourced position returns `hidden` (there is nothing better to offer),
 * and so does a profile-sourced one whose device permission is `denied` — that
 * rider has a working position and no route to a better one, so a control
 * offering the upgrade would be a dead end.
 */
export type LocationPrimingState = 'hidden' | 'ask' | 'blocked' | 'town' | 'refine'

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

  // **No geolocation on this platform at all — so the town question is the
  // WHOLE offer here, not a fallback from one.** This returned `hidden` until
  // PD-419, on the grounds that there was nothing to offer; that was true only
  // while the device was the single source. A rider on a WebView with no
  // geolocation, or behind an MDM that strips it, previously had no route to a
  // position of any kind and no affordance anywhere saying so.
  if (permission === 'unavailable') return position === null ? 'town' : 'hidden'

  // **A rider who has a position is offered an upgrade only when there is one
  // to offer** — see the type's own PD-419 section for what changed and why.
  // `device` is already the best answer this app has; `denied` has no route to
  // a better one from inside the app, so both draw nothing.
  if (position !== null) {
    return position.source === 'profile' && permission === 'prompt' ? 'refine' : 'hidden'
  }

  return permission === 'denied' ? 'blocked' : 'ask'
}
