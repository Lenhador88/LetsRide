import type { PhotoLocation, PhotoLocationMode } from '@/lib/media'

/**
 * The three buttons, and the line under each that says what it actually does.
 *
 * **The hint is the design, not decoration.** Each mode is described in the
 * rider's own terms rather than the schema's, and `Precise` says the quiet part
 * out loud — because the one thing a rider must not be able to do is publish
 * their driveway without having been told that is what they are doing.
 *
 * **`Hide` is scoped to what LETSRIDE stores, and the scope is load bearing.**
 * A photo's capture time is uploaded whatever mode is chosen, so a string like
 * "nothing about this photo leaves your phone" would be false. Whether Hide
 * *should* also cover the time was PD-265, and the product owner settled it on
 * 2026-08-18: it should not.
 *
 * The sentence used to read *"The photo's location never leaves your phone."*
 * That was a promise about the DEVICE, and the place lookup is a request to a
 * third party — so the product owner chose (2026-08-20) to fire that lookup only
 * once the rider taps `Region`, which keeps the old sentence true, and to reword
 * it anyway so it says the thing riders actually care about. **It is scoped to
 * LetsRide rather than to the world**: a rider who taps `Region`, is shown a
 * lookup, and comes back to `Hide` has had a ~1 km cell reach a geocoder, so
 * "not stored anywhere" would be a promise about somebody else's logs. What this
 * app does with it is a promise this app can keep.
 *
 * Widening any of these is how the app starts making a promise the schema does
 * not keep — the rule `CLAUDE.md` and `064` both carry.
 *
 * ## Why this is a module rather than a const in the component
 *
 * Because two of the three sentences are **conditional on what is actually
 * going to be stored**, not on which button is pressed, and a mode whose
 * sentence is wrong is the one defect on this screen that cannot be seen by
 * looking at it — the rider is told a thing is saved and the row says
 * otherwise. `resolveLocationCopy` is the pure half, split out so it has a
 * tripwire, for the same reason `PlaceSearchField`'s `resolveComboboxKey` and
 * `guard.ts` are.
 */
export const LOCATION_MODES: {
  value: PhotoLocationMode
  label: string
  lead: string
  hint: string
}[] = [
  {
    value: 'hide',
    label: 'Hide',
    lead: 'Nothing is saved.',
    hint: 'LetsRide never stores the location of this photo.',
  },
  {
    value: 'place',
    label: 'Region',
    lead: 'Only the place you name is saved.',
    // Says nothing about a ride. The old string read "Enough to place it on the
    // ride" — and this form has no ride field at all, so `ride_id` is NULL on
    // every postcard it has ever written. The product owner reported it as
    // wrong from a club; it was wrong from everywhere, which is why the fix is
    // one context-free sentence rather than three conditional ones.
    //
    // **"the place you named", not "the town"** — the review pass caught the
    // overclaim. The typeahead is a geocoder and returns streets as readily as
    // towns, so a rider CAN name their own street here. What is true whatever
    // they name is this: the words are theirs, and the coordinate under them is
    // rounded to a ~1 km cell before it is sent. The prefill is narrower still
    // — the proxy asks the vendor for a city — so an auto-filled value is
    // always a locality.
    //
    // **The label is `Region` and the stored marker is `place`, and they are
    // deliberately different words.** Product owner, 2026-08-20: `Town` is too
    // narrow for what the field holds — a rider in the Pyrenees names a
    // mountain range, not a town. `Region` is the rider-facing word for that.
    // The marker stays `place` because `'region'` is ALREADY a live value in
    // `taken_location_precision` meaning the retired ~1 km rounding, and one
    // DEV row carries it; reusing the string would make one word mean two
    // things in the same column. Nothing here writes `'region'` ever again.
    hint: 'Whoever can see this postcard sees the place you named, never the exact spot.',
  },
  {
    value: 'precise',
    label: 'Precise',
    lead: 'Saved exactly.',
    // **The PHOTO-FIX wording specifically.** `Precise` has two sources and a
    // third state with neither; `resolveLocationCopy` overrides this for the
    // other two. The entry keeps the commonest case rather than a placeholder,
    // so no string here is one that nothing ever renders.
    hint: 'Anyone who can see this postcard can see where you took the photo.',
  },
]

export type LocationCopy = { lead: string; hint: string }

/**
 * What to say under the buttons, given what is **actually** going to be stored.
 *
 * `stored` is `resolvePhotoLocation`'s own `precision`, so the sentence and the
 * hidden inputs are computed from one answer and cannot disagree about whether
 * anything is being saved. That is the whole contract: the two states this
 * function exists for are the ones where a mode is selected and the row it
 * would write is empty.
 *
 * - **`Region` with an empty field.** The constant sentence reads "Only the
 *   place you name is saved", and nothing is — the rider has named nothing.
 *   Found by review, 2026-08-20, as the asymmetry left behind when `Precise`
 *   got this treatment and `Region` did not.
 * - **`Precise` with no photo fix and no PICKED place.** Same shape: the mode
 *   resolves to `hide`'s answer, and "Saved exactly" would be a lie about an
 *   empty row.
 *
 * **`Hide` is never conditional** — it stores nothing by definition, so its
 * sentence is true in every state and reading `stored` for it would invent a
 * distinction the rider does not have.
 */
export function resolveLocationCopy(
  mode: PhotoLocationMode,
  stored: PhotoLocation['precision'],
  hasPhotoFix: boolean
): LocationCopy {
  const entry = LOCATION_MODES.find((m) => m.value === mode)!

  if (mode === 'hide') return { lead: entry.lead, hint: entry.hint }

  if (stored === null) {
    return mode === 'place'
      ? {
          lead: 'Nothing to save yet.',
          hint: 'Name a place above and that name is what gets saved.',
        }
      : {
          lead: 'Nothing to save yet.',
          // **Names the escape hatch, and that is not padding.** Only a PICKED
          // place is exact enough for this mode, and picking needs the
          // geocoder — which is unavailable offline and once `069`'s hourly
          // ceiling is spent. Advice that can be impossible to follow is worse
          // than none, so the sentence carries the mode that always works.
          hint: 'This photo carries no location. Pick a place from the list above, or choose Region to save just the name.',
        }
  }

  if (mode === 'precise' && !hasPhotoFix) {
    return {
      lead: 'Saved exactly.',
      hint: 'The place you picked, to the metre — not where the photo was taken.',
    }
  }

  return { lead: entry.lead, hint: entry.hint }
}
