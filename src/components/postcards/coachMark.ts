/**
 * Whether this device has been shown the deck's swipe coach mark, and the one
 * write that spends it.
 *
 * A plain module rather than a hook, for the reason `deck.ts` already gives:
 * it can be tested without mounting React, and `vitest.config.ts` is
 * `environment: 'node'` so a browser `Storage` is not available to import.
 * Both functions take the store as an argument for the same reason — the test
 * hands them a fake, and the caller does the `window` lookup.
 *
 * **Named for the concern rather than for `SwipeCoach`**, which is the same
 * convention `deck.ts` and `viewerContext.ts` already follow beside their own
 * components — and here it is load-bearing rather than tidy. A `swipeCoach.ts`
 * beside a `SwipeCoach.tsx` differs only in case, and `tsconfig.json`'s
 * `"moduleResolution": "bundler"` probes `.tsx` before `.ts` for an
 * extensionless specifier: on a case-insensitive filesystem — APFS by default,
 * so any ordinary Mac clone — the import of the flag resolves to the component
 * module instead, which exports none of these names. Every gate here is Linux
 * and case-sensitive, so that failure never reaches CI and surfaces only on a
 * developer's machine, reading as a phantom missing export.
 *
 * **Per device, deliberately.** PD-324's assumed default: a `localStorage` key,
 * no migration, nothing on the guard's critical path. The honest cost is that
 * the same rider meets the coach mark again on a second device; a `profiles`
 * column would fix that and costs a migration, a column grant and a read, and
 * the product owner has not asked for one.
 */

/**
 * Namespaced under `letsride:` because `clearSessionStore()` sweeps
 * `localStorage` on sign-out and keys everything it removes on the Supabase
 * prefix — `session-store.test.ts` asserts a `letsride:`-prefixed key survives
 * that sweep. Signing out must not re-arm the coach mark: it is a fact about
 * the device, not about the session.
 */
export const SWIPE_COACH_KEY = 'letsride:postcard-swipe-coached'

/**
 * The value is never read for its content — presence is the whole signal — so
 * this is a marker rather than data. Written as `1` because that is what the
 * store-availability probe in `session-store.ts` writes, and a one-character
 * value keeps a quota-bound store from failing on the thing meant to stop the
 * coach mark returning.
 */
const SEEN = '1'

/**
 * The device's `localStorage`, or `null` where there is not one to reach.
 *
 * Three cases collapse into that `null` and all three are real: the SSR/
 * prerender pass, where there is no `window` at all; Safari with cookies
 * blocked, where the *getter itself* throws rather than returning null; and a
 * browser configured to refuse site data. `session-store.ts` documents the same
 * hazard and guards it the same way — the access is inside the `try`, not just
 * the call on the result.
 */
export function swipeCoachStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Whether this call is the deck's first sight on this device — and, if it is,
 * spends the flag in the same breath.
 *
 * **The write happens when the coach mark is decided rather than when it is
 * dismissed, and that ordering is the design.** PD-324: *"a coach mark that
 * returns is worse than none."* Dismissal has three routes (a swipe, a tap, a
 * timeout) and a rider can leave the screen before any of them arrives — a
 * navigation, a backgrounded app, a reload — so marking it there leaves the
 * flag unwritten on exactly the paths nobody watches, and the coach mark comes
 * back. Claiming at first sight cannot: the only way to see it twice is for the
 * write to have failed, which is the next paragraph.
 *
 * **A store that cannot be written answers `false`, so the coach mark never
 * shows there.** That is the fail-safe direction rather than an oversight: with
 * no way to persist, showing it means showing it on *every* mount of the deck —
 * every filter change, every visit — which is the returning coach mark the
 * issue rules out. A rider in a locked-down browser loses the hint; a rider in
 * one gets a permanent overlay, and only one of those two is a defect worth
 * shipping.
 */
export function claimSwipeCoach(store: Storage | null): boolean {
  if (!store) return false
  try {
    if (store.getItem(SWIPE_COACH_KEY) !== null) return false
    store.setItem(SWIPE_COACH_KEY, SEEN)
    return true
  } catch {
    // A read that throws (disabled site data) and a write that throws (private
    // mode, quota) land here identically, and the answer is the same for both:
    // nothing was persisted, so nothing may be shown.
    return false
  }
}
