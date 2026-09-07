/**
 * Whether this device has already been asked, unprompted, where its rider is —
 * PD-419.
 *
 * ## The rule it enforces
 *
 * Product owner, 2026-09-06: the app asks *"at Explore, once, automatically,
 * ever"*, and after that the affordance is a row the rider taps when they want
 * it. So this answers exactly one question — **has the automatic ask already
 * been spent** — and nothing else. A rider who taps the row gets the sheet
 * however many times they like; this never gates that.
 *
 * ## Why it persists, where every other one-shot in this app does not
 *
 * `introduction-dismissal.ts` is the shape next door and it is deliberately
 * **per session**: a club's introduction prompt should come back tomorrow,
 * because the rider may well introduce themselves then. This one must not. The
 * thing being spent is the device's OS permission dialog, which on iOS is
 * one-way per install — so an ask that re-fires on the next cold start is an
 * app that opens a permission sheet every morning until the rider taps `Not
 * now` hard enough to mean it, which is precisely how riders come to decline
 * permanently. A session-scoped flag would look identical in every test and be
 * wrong on the second launch.
 *
 * ## Failing open is the safe direction here, and it is a real decision
 *
 * Every read and write is wrapped, because `localStorage` **throws** rather
 * than returning null in a private window, under a browser set to block site
 * data, and inside some WebView previews. A throw on read is treated as *not
 * yet asked*, so the worst case is a rider in a private window seeing the sheet
 * once per session — a nuisance. The alternative reading, *treat an unreadable
 * store as asked*, silently removes the automatic ask for that rider for ever,
 * and there is no signal anywhere that it happened.
 *
 * **A failed WRITE is the one that costs**, and it is unavoidable: if the store
 * refuses the write, the ask repeats next session. That is the same nuisance as
 * above and it is the only outcome available — there is nowhere else to put
 * this. It is per-device rather than per-rider on purpose: the OS permission it
 * spends is per-device too, so a rider signing in on a second phone is a rider
 * whose second phone has never asked.
 */
const KEY = 'letsride.location.asked'

export function hasAskedForLocation(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1'
  } catch {
    // Unreadable store — see the header. "Not yet asked" is the failure this
    // app can live with; the other one is invisible.
    return false
  }
}

export function markAskedForLocation(): void {
  try {
    globalThis.localStorage?.setItem(KEY, '1')
  } catch {
    // Nowhere else to record it. The ask repeats next session, which is the
    // nuisance the header prices rather than a state to recover from.
  }
}

/** Test seam, matching `resetRiderLocationCacheForTests`. Nothing in the app
 *  calls it. */
export function resetAskedForLocationForTests(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
