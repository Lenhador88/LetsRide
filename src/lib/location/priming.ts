import { localityOf } from '@/lib/countries'
import type { DeviceLocationPermission, RiderLocation } from '@/lib/location/rider-location'

/**
 * What, if anything, a screen should draw to ask a rider where they ride from —
 * PD-170, rewritten by PD-447.
 *
 * ## Why this is a pure function rather than logic inside the component
 *
 * Same reason `resolveComboboxKey` was split out of `PlaceSearchField`: the
 * decision has four inputs' worth of states and exactly one of them is a
 * rendering question. Split, every state gets a named test; folded into the
 * component, only the two states a `renderToStaticMarkup` pass can reach do.
 *
 * ## The six answers
 *
 * - **`hidden`** — draw nothing at all. The default, and the answer for every
 *   state where a row would be noise or a lie.
 * - **`ask`** — the device will show its permission dialog if something asks.
 *   This is the state the priming sheet exists for: explain first, and let the
 *   rider spend the one prompt deliberately.
 * - **`blocked`** — the device has already refused, and on iOS that refusal is
 *   one-way from inside the app. The row still draws, but it opens the sheet's
 *   *denied* copy: what is lost, where to switch it back on, and the town
 *   question, which is the route out that does not go through the Settings app.
 * - **`town`** — there is no device to ask at all and no position either, so the
 *   device story never starts. The row goes straight to the town question.
 * - **`refine`** — the rider HAS a position, from their town rather than the
 *   device, and the device could still be asked. The row asks whether the town
 *   is still right, with the device offer behind it.
 * - **`confirm`** — the rider has a town-sourced position and there is **no
 *   device to offer**: it refused, or the platform has none. The row asks the
 *   same question and goes straight to the town sheet.
 *
 * ## PD-447 — the row asks rather than offers, and nothing opens by itself
 *
 * **This deliberately reverses PD-419's automatic ask.** That change opened the
 * priming sheet by itself at Explore, once per install, on a 700ms timer. It is
 * gone: no sheet in this app opens without a rider gesture. **The accepted cost
 * is fewer device grants** — a rider who never taps the row is never asked —
 * and it is accepted in exchange for an app that never raises a permission
 * sheet unasked, which is the shape that teaches riders to dismiss prompts
 * reflexively. A later session reading for the missing timer should read this
 * paragraph rather than restoring one.
 *
 * What PD-419 built and this keeps: the two-rung ladder (ask the device, and if
 * that is declined or unavailable ask for a town), and the rule that a rider
 * who already has a position is still told **where the distances on screen are
 * measured from**, because a rider whose profile says Utrecht and who is in
 * Maastricht could otherwise not find out why every distance looks wrong.
 *
 * ## `confirm` is a sixth state rather than a branch in the component
 *
 * Before PD-447 a profile-sourced position with `denied` returned `hidden` —
 * correct while the row said *Use my location*, since iOS will not re-raise the
 * dialog for the life of the install and the row would have been a dead end.
 * Once the row asks about the **town**, that rider has a route that works, so
 * the exclusion is lifted — **for the town half only**. Returning `refine` and
 * branching in the component on the permission would put the dead end one
 * `if` away from coming back; a named state cannot, and gets its own test.
 *
 * ## Nothing renders against a guess
 *
 * All four inputs must be settled. Three of them are asynchronous — the
 * Permissions API, the position resolver and the profile read — and a row drawn
 * against an unread one is drawn against a guess that is wrong for exactly the
 * rider who already answered, who would then watch a question about a town they
 * set months ago appear and vanish on every load.
 */
export type LocationPrimingState = 'hidden' | 'ask' | 'blocked' | 'town' | 'refine' | 'confirm'

export function locationPrimingState({
  permission,
  position,
  town,
  quiet,
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
  /**
   * `profiles.location`, **raw** — `undefined` until the profile read lands,
   * `null` for a rider with none.
   *
   * It is the column rather than `nearLabel`'s output on purpose, and the
   * label below says why: `nearLabel` answers the literal `you` in two
   * branches, which reads as `Still in you?` here.
   */
  town: string | null | undefined
  /**
   * Whether a recent dismissal is still silencing the question —
   * `isQuestionQuiet()`. **`undefined` until the store has been read**, which
   * is an effect like the other three.
   */
  quiet: boolean | undefined
}): LocationPrimingState {
  // **Nothing renders until every input is decided.** See the header.
  if (permission === undefined || position === undefined) return 'hidden'
  if (town === undefined || quiet === undefined) return 'hidden'

  // The rider closed this question recently and the interval has not run out.
  // Checked before anything else that could draw, so a dismissal silences every
  // visible state rather than only the one that was on screen when it happened.
  if (quiet) return 'hidden'

  // Already granted: there is no question left to ask, and the distances on
  // screen are measured from the device rather than from any town. A `null`
  // position in this state is a GPS acquisition that failed or timed out, which
  // is a different problem with a different answer.
  if (permission === 'granted') return 'hidden'

  if (position !== null) {
    // A device fix with a non-`granted` permission is the five-minute resolver
    // memo outliving a revocation. The position on screen is real and the row
    // has nothing better to offer, so it draws nothing rather than asking about
    // a town the distances are not measured from.
    if (position.source === 'device') return 'hidden'

    // Town-sourced. `prompt` still has a device to offer; `denied` and
    // `unavailable` do not, and go straight to the town — the lifted exclusion.
    return permission === 'prompt' ? 'refine' : 'confirm'
  }

  // No position at all. The device is the first rung where there is one.
  if (permission === 'unavailable') return 'town'
  return permission === 'denied' ? 'blocked' : 'ask'
}

/**
 * The one line the row draws, or `null` when it draws nothing.
 *
 * ## Why the copy lives beside the decision and not in `explore-label.ts`
 *
 * That module and `near-label.ts` exist because one *sentence about distance*
 * was written twice and drifted (PD-427), and four surfaces read them: both
 * Explore strips and both Explore lists. This is a different sentence with a
 * different subject, read by one component — putting it there would widen two
 * modules that were narrowed on purpose, and a later edit to the Explore
 * sentence would land in the same file as the question. One module owning *the
 * state and the string for that state* is `setting.ts`'s shape.
 *
 * ## It must NOT call `nearLabel()`
 *
 * `nearLabel` answers `{ name: 'you' }` in two branches — a device-sourced
 * position, and a profile city `localityOf` declines to shorten. Today's
 * `Near you · Use my location` absorbs that; **`Still in you?` does not.** So
 * the town is reduced here, from the raw column, the way `describeRiderLocation`
 * does it. The rule `near-label.ts` states — *the name must come from the same
 * source as the number* — is still obeyed: in `refine` and `confirm` the number
 * IS the town.
 *
 * A town that will not reduce to a locality falls back to the question with no
 * name in it rather than rendering `Still in ?`. `localityOf` returns `null`
 * only for a string with nothing before its first comma, which a geocoded
 * position makes unlikely rather than impossible — `018` permits a town of
 * spaces.
 */
export function locationQuestionLabel(
  state: LocationPrimingState,
  town: string | null | undefined
): string | null {
  if (state === 'hidden') return null

  if (state === 'refine' || state === 'confirm') {
    const locality = localityOf(town)
    if (locality) return `Still in ${locality}?`
  }

  return 'Where do you ride from?'
}
