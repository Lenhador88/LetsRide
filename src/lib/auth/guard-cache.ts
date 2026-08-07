import { needsOnboardingState, onboardingStateFrom, type GuardState } from '@/lib/auth/guard'
import { createClient } from '@/lib/supabase/client'
import type { OnboardingState } from '@/types'

/**
 * What the route guard knows, held across navigations instead of re-fetched per
 * route (PD-111).
 *
 * ## The bug this exists to kill
 *
 * `RouteGuard` used to resolve its decision in an effect keyed on `pathname`,
 * so *every* navigation started in the deciding state and stayed there for a
 * round trip to `eu-west-1` — `needsOnboardingState` is true for every
 * non-public path, so `my_onboarding_state()` fired on every tab tap. The splash
 * replaced `children` while that ran, which unmounted `(app)/layout.tsx` with
 * it, so the bottom bar and the background gradient tore down and remounted.
 * Tapping a tab read as a page reload.
 *
 * Both answers are effectively immutable for a session's lifetime — onboarding
 * completes once, consent stamps once — so the re-fetch bought nothing. Held
 * here, `resolveDestination` (already pure and synchronous) decides in the same
 * tick and the splash never paints again after boot.
 *
 * ## Module state, and why it is safe on the server
 *
 * Next still server-renders this app's client components, and module state on
 * the server is per-process rather than per-request — so a module-level cache of
 * *who is signed in* is the shape of a cross-user leak. It is safe here because
 * **nothing writes it during render**, and that is enforced rather than
 * observed: all four writers — `ensureGuardState`, `attachGuardAuthListener`,
 * `invalidateOnboardingState` and `clearGuardCache` — refuse without a
 * `document`. The server's copy therefore stays permanently at "nothing known",
 * which renders the splash: the same thing it rendered before.
 *
 * The last two are reachable only from a `useActionState` submit handler today,
 * so the guard is belt-and-braces *today*. It is here because the property is
 * what makes this module safe at all, and a property that holds by call graph
 * stops holding the day somebody changes the call graph — silently, and in the
 * direction where one rider sees another's state.
 *
 * **The user id never leaves this module.** `GuardSnapshot` carries `signedIn`
 * as a boolean rather than the id it is derived from: the id exists only to
 * notice that a *different* rider signed in, which is this module's business and
 * not a component's, and an id in a render tree is one `console.log` away from
 * being in an error report.
 *
 * ## Writers
 *
 * `onAuthStateChange` is the single writer for the **session** half: sign-in,
 * sign-out, token refresh and user change all arrive there, so no caller has to
 * remember to keep it in step. The **stamps** have three more, and they are
 * writes rather than events, so nothing could deliver them here: `signUp`,
 * `setUsername`, `acceptTerms` and `setLocation` each change a field the
 * decision reads and each calls `invalidateOnboardingState`. `signOut` calls
 * `clearGuardCache`. That is the whole list, and it is worth stating in full
 * because the safety property above — nothing writes during render — is a
 * property of *every* writer, not just the two in this file.
 *
 * **The callback issues no Supabase call of its own**, and the reason is
 * narrower than the one first written here. That said the callback runs "while
 * the auth lock is held", which is **false for this client**: `auth-js@2.111.0`
 * leaves `this.lock` null unless a `lock` is passed to `createClient`, and
 * `lib/supabase/client.ts` passes none, so the lockless path is what runs.
 * Measured, after review caught the claim — the exact error CLAUDE.md names as
 * reasoning where measurement was available.
 *
 * What is true, and is reason enough: `_notifyAllSubscribers` **awaits every
 * callback**, so anything awaited in here is awaited by the emitter. The
 * library's own comment describes the resulting deadlock against
 * `initializePromise` — which it now defuses by queueing init-chain
 * notifications, so this is a rule that keeps a foot out of a trap the library
 * has already moved, rather than one holding a live bug shut. The RPC stays in
 * `read`, which runs from the guard's effect.
 */

/**
 * `undefined` — never read this page load, so nothing can be decided yet.
 * `null` — read, and there is no session.
 *
 * The id rather than a boolean, because a *different* rider signing in has to
 * drop the stamps below. `SIGNED_OUT` then `SIGNED_IN` covers the ordinary case,
 * but `USER_UPDATED` arrives with no such pair.
 */
let userId: string | null | undefined
let onboarding: OnboardingState | undefined
/**
 * A read that answered `unavailable`. Held so the decision stays *synchronous*
 * and fail-closed rather than hanging on the splash — but deliberately not held
 * as an answer: `ensureGuardState` re-attempts it on the next navigation, the
 * same way `queryClient`'s `isStale` treats an error as always stale. A failed
 * read must never harden into a verdict.
 */
let unavailable = false

/**
 * The pathname of the most recent read attempt.
 *
 * **Consulted in exactly one branch** — the `unavailable` retry in
 * `ensureGuardState`, to stop that retry firing once per render instead of once
 * per navigation. Every other branch has already decided from the session and
 * the stamps by the time it could matter, so a value left over from an earlier
 * path is inert rather than wrong, and only a full clear resets it.
 *
 * It was reset by `writeSession` in the first draft, which broke the one thing
 * it is for: the very first read writes the session mid-flight, so the guard
 * cleared itself before the failure it was guarding could be recorded, and the
 * retry looped. Caught by `guard-cache.test.ts`, not by review.
 */
let attemptedPath: string | null = null
let inFlight: Promise<void> | null = null
let subscribed = false

/**
 * Everything a render needs, and nothing it does not.
 *
 * Rebuilt only inside `notify`, so `getGuardSnapshot` returns the same object
 * reference across calls that observe no change — required by
 * `useSyncExternalStore`, which loops if `getSnapshot` allocates every call.
 * Same construction as `queryClient.ts`'s per-entry snapshot, for the same
 * reason.
 */
export type GuardSnapshot = {
  /** `undefined` until the first read lands. */
  signedIn: boolean | undefined
  onboarding: OnboardingState | undefined
  unavailable: boolean
}

/** What the SSR pass and the hydration render both see — see the module note on
 * server state. Frozen and shared, so those two renders agree by identity. */
const EMPTY_SNAPSHOT: GuardSnapshot = Object.freeze({
  signedIn: undefined,
  onboarding: undefined,
  unavailable: false,
})

let snapshot: GuardSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()

function notify(): void {
  snapshot =
    userId === undefined && onboarding === undefined && !unavailable
      ? EMPTY_SNAPSHOT
      : { signedIn: userId === undefined ? undefined : userId !== null, onboarding, unavailable }
  for (const listener of listeners) listener()
}

export function getGuardSnapshot(): GuardSnapshot {
  return snapshot
}

export function getServerGuardSnapshot(): GuardSnapshot {
  return EMPTY_SNAPSHOT
}

export function subscribeGuardCache(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Has the guard decided anything at all this page load?
 *
 * It is the boot/warm split: before the first answer there is nothing on screen
 * worth preserving and nothing vetted to reveal, so the splash replaces
 * `children`. After it, the splash may overlay them instead — see `RouteGuard`.
 */
export function hasGuardBooted(state: GuardSnapshot): boolean {
  return state.signedIn !== undefined
}

/**
 * The decision's input, or `undefined` when it cannot be answered without a
 * round trip.
 *
 * Pure, and takes the snapshot rather than reading module state, so a render can
 * call it in its body and a test can call it without one.
 */
export function guardStateFrom(state: GuardSnapshot, pathname: string): GuardState | undefined {
  if (state.signedIn === undefined) return undefined
  if (!state.signedIn) return { kind: 'anonymous' }
  // The legal pages and the whole recovery flow, which never needed the stamps —
  // `readGuardState` skipped the round trip for them and so does this.
  if (!needsOnboardingState(pathname)) return { kind: 'session' }
  if (state.onboarding) return { kind: 'rider', ...state.onboarding }
  if (state.unavailable) return { kind: 'unavailable' }
  return undefined
}

/**
 * Fill whatever `guardStateFrom` could not answer for this path. A no-op once
 * the cache can answer, which is what makes it safe to call from an effect that
 * re-runs on every cache change.
 */
export function ensureGuardState(pathname: string): void {
  if (typeof document === 'undefined') {
    throw new Error(
      'ensureGuardState ran during a server render. There is no session to read ' +
        'there — call it from an effect. See src/lib/auth/guard-cache.ts.'
    )
  }

  const cached = guardStateFrom(snapshot, pathname)
  if (cached !== undefined) {
    if (cached.kind !== 'unavailable') return
    // Retry the failed read once per navigation. Without this guard the retry
    // notifies, the notify re-runs the effect, and the effect retries — a render
    // loop hammering an accessor that is already answering errors.
    if (attemptedPath === pathname) return
  }
  if (inFlight) return

  attemptedPath = pathname
  inFlight = read(pathname).finally(() => {
    inFlight = null
  })
}

/**
 * `getSession()`, not `getUser()`. `getUser()` revalidates the token against
 * GoTrue on every call, which would put a network round trip in front of the one
 * decision this cache exists to make synchronous — and it would buy nothing,
 * because the guard is not a security boundary (RLS is, and it verifies the
 * signature itself on every query). A forged local session reaches a screen
 * where every read returns nothing.
 *
 * The onboarding stamp is read through `my_onboarding_state()` rather than a
 * table select because `025` revokes column SELECT on both stamps — a select
 * naming them answers 403, which the `unavailable` branch would read as a deploy
 * mismatch and bounce every signed-in rider out of every screen. The function
 * returns the three things this needs in one round trip.
 */
async function read(pathname: string): Promise<void> {
  const supabase = createClient()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    writeSession(null)
    notify()
    return
  }

  writeSession(session.user.id)

  if (!needsOnboardingState(pathname)) {
    notify()
    return
  }

  // The mapping — including the zero-rows case, which must not read as "not
  // onboarded" — lives in `onboardingStateFrom` so it has a test.
  const state = onboardingStateFrom(
    await supabase.rpc('my_onboarding_state').maybeSingle<OnboardingState>()
  )

  if (state.kind === 'rider') {
    onboarding = {
      terms_accepted_at: state.terms_accepted_at,
      onboarding_completed_at: state.onboarding_completed_at,
      has_username: state.has_username,
    }
    unavailable = false
  } else {
    onboarding = undefined
    unavailable = true
  }

  notify()
}

/** Does not notify — every caller either notifies once afterwards or is itself
 * a notifying entry point, so a session write and the stamp write it precedes
 * cost one render rather than two. */
function writeSession(next: string | null): void {
  if (userId !== next) {
    // A different rider — or none — so the stamps belong to somebody else.
    onboarding = undefined
    unavailable = false
  }
  userId = next
}

/**
 * Installs the single writer. Idempotent, because `RouteGuard` mounts once but
 * its effects may run twice under StrictMode.
 *
 * The subscription is deliberately never torn down: the guard is mounted in the
 * root layout for the whole life of the page, and a teardown-on-unmount would
 * only ever fire during StrictMode's double-invoke, leaving the cache with no
 * writer for the rest of the session.
 */
export function attachGuardAuthListener(): void {
  if (subscribed) return
  if (typeof document === 'undefined') return
  subscribed = true

  createClient().auth.onAuthStateChange((event, session) => {
    // No Supabase call from in here — see the module note on the callback.

    // **A new session clears the failed-read latch, and this is not the same as
    // `writeSession`'s id check.** That check drops the *stamps* when a
    // different rider arrives; this drops the *failure*, for the same rider
    // too. Without it a rider whose stamp read failed is parked on
    // `/auth/login?error=profile_unavailable` — the one path `resolveDestination`
    // answers `null` for in that state — with `attemptedPath` latched to it, so
    // signing in again fixes nothing and no navigation is available to trigger
    // the retry. The credential is exactly what may have been wrong, so a fresh
    // one is precisely when re-attempting is worth it.
    unavailable = false
    attemptedPath = null

    if (event === 'SIGNED_OUT' || !session) {
      writeSession(null)
      notify()
      return
    }
    writeSession(session.user.id)
    notify()
  })
}

/**
 * Drop the stamps, keeping the session. For the three onboarding writes —
 * `setUsername`, `acceptTerms` and `setLocation` — each of which changes a field
 * the decision reads.
 *
 * Invalidation rather than a patch, even though each of those knows what it just
 * made true: two of the three stamps are timestamps this side never sees, so a
 * patch would have to fabricate them, and a fabricated value in a cache is the
 * unlabelled guess CLAUDE.md's working principles exist to prevent. The cost is
 * one round trip at three points in a once-per-account flow.
 *
 * Without it a rider finishes a step and the guard, reading the stamp it cached
 * a moment earlier, sends them straight back into it.
 */
export function invalidateOnboardingState(): void {
  if (typeof document === 'undefined') return
  onboarding = undefined
  unavailable = false
  notify()
}

/**
 * Everything, back to "nothing known". Called by `signOut`.
 *
 * **The `SIGNED_OUT` event does already arrive in time, and this is not a
 * correction of that.** Measured against the installed `@supabase/auth-js`
 * rather than recalled: `_notifyAllSubscribers` awaits every callback, and
 * `_removeSession` awaits it in turn — so by the time `supabase.auth.signOut()`
 * resolves, the listener above has already written `null`. This is the same
 * guarantee stated synchronously and locally, and it is worth having because of
 * what it prevents if that ordering ever changes: a cache still holding an
 * onboarded rider answers `/auth/login` with `'/postcards'`, so the rider who
 * just signed out is bounced straight back into the app. CLAUDE.md pins
 * `@supabase/supabase-js` exact for precisely this class of silent auth-flow
 * change, which is the argument for not depending on the ordering alone.
 */
export function clearGuardCache(): void {
  if (typeof document === 'undefined') return
  userId = undefined
  onboarding = undefined
  unavailable = false
  attemptedPath = null
  inFlight = null
  notify()
}

/**
 * Test seam, matching `resetClientForTests`. Nothing in the app calls it.
 *
 * Resets the fields directly rather than calling `clearGuardCache`, which now
 * refuses without a `document` — a seam that only works when the fake browser
 * happens to be installed is a seam that fails in the one test that removes it.
 */
export function resetGuardCacheForTests(): void {
  userId = undefined
  onboarding = undefined
  unavailable = false
  attemptedPath = null
  inFlight = null
  subscribed = false
  snapshot = EMPTY_SNAPSHOT
  listeners.clear()
}
