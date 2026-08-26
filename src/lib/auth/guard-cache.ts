import { needsOnboardingState, onboardingStateFrom, type GuardState } from '@/lib/auth/guard'
import { createClient } from '@/lib/supabase/client'
import { clearQueryCache } from '@/lib/query'
import { clearRiderLocation } from '@/lib/location/rider-location'
import { clearSessionStore } from '@/lib/supabase/session-store'
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
 * observed: all five writers — `ensureGuardState`, `attachGuardAuthListener`,
 * `retryGuardRead`, `invalidateOnboardingState` and `clearGuardCache` — refuse
 * without a `document`. The server's copy therefore stays permanently at
 * "nothing known", which renders the splash: the same thing it rendered before.
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
 * `setUsername` and `acceptTerms` each change a field the decision reads and
 * each calls `invalidateOnboardingState`. `setUsername` is the terminal one
 * since PD-286 dropped the location step — it commits the completion stamp
 * itself, immediately after the username write, so its invalidation is the
 * one that fires last in the wizard. `signOut` calls `clearGuardCache`. That
 * is the whole list, and it is worth stating in full because the safety
 * property above — nothing writes during render — is a property of *every*
 * writer, not just the two in this file.
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
 * A read that answered `gone` — the account this session names no longer
 * exists (PD-102). Unlike `unavailable`, this DOES harden into a verdict:
 * `ensureGuardState`'s retry guard only special-cases `kind !== 'unavailable'`,
 * so a `gone` answer is never re-attempted, which is correct — a deleted
 * account does not un-delete itself on the next navigation. Set at the same
 * moment `read()` triggers `destroySessionForDeletedAccount`, below.
 */
let gone = false
/**
 * A read that **threw** rather than answering (PD-122).
 *
 * Distinct from `unavailable` in what is known rather than in where it sends
 * the rider: `unavailable` is a *resolved* accessor carrying an error, so the
 * session was read and only the stamps are missing — the decision can be made,
 * fail-closed, and `resolveDestination` has a destination for it. A rejection
 * can land before `getSession()` ever answers, so there is no session, no
 * stamps, and nothing to decide from. The guard therefore cannot route at all,
 * and routing anyway would be inventing an answer it does not have.
 *
 * So this state is not a destination, it is a *screen*: `resolveGuardView`
 * turns it into the retry the splash never offered. Before it existed a
 * rejected read notified nothing, which left the full-screen splash up with no
 * tap target on it and only a reload to escape — total, for a rider with no way
 * to report what they saw.
 *
 * Latched until something re-attempts, and that latch is load-bearing: the
 * failure notifies, the notify re-runs `RouteGuard`'s effect, and the effect
 * calls `ensureGuardState` — so without it a failing read retries itself once
 * per render forever.
 */
let failed = false

/**
 * The pathname of the most recent read attempt.
 *
 * **Consulted in two branches** — the `unavailable` retry in
 * `ensureGuardState` and the `failed` latch beside it, both to stop a retry
 * firing once per render instead of once per navigation. Every other branch has
 * already decided from the session and the stamps by the time it could matter,
 * so a value left over from an earlier path is inert rather than wrong, and
 * only a full clear resets it.
 *
 * It was reset by `writeSession` in the first draft, which broke the one thing
 * it is for: the very first read writes the session mid-flight, so the guard
 * cleared itself before the failure it was guarding could be recorded, and the
 * retry looped. Caught by `guard-cache.test.ts`, not by review.
 */
let attemptedPath: string | null = null

/**
 * How many times the stamps have been thrown away (PD-304).
 *
 * **A read is only allowed to write what it learned if nothing moved
 * underneath it**, and this counter is how a read that started before a write
 * finds that out after the fact. `invalidateOnboardingState` and
 * `clearGuardCache` each bump it; `attemptRead` captures it before its first
 * await and discards its answer if it has changed.
 *
 * The defect without it: `signUp` establishes the session, then calls
 * `accept_terms()`, then invalidates. The session landing wakes the guard's
 * effect, which issues a read — and that read asks `my_onboarding_state()`
 * *before* the consent stamp is written. The invalidation clears the cache
 * correctly, and then the older read resolves and refills it with
 * `terms_accepted_at: null`. The rider who ticked the box ten seconds ago is
 * sent to `/onboarding/terms`, and `021`'s idempotence is the only reason that
 * is a papercut rather than a lockout.
 *
 * So the hazard CLAUDE.md names — "any new writer of a stamp the decision reads
 * must invalidate the cache" — is necessary and was never sufficient: all four
 * writers do invalidate, and an invalidation cannot reach a round trip that has
 * already left.
 *
 * **It covers the writers that bump it, and the session half has one that does
 * not.** `onAuthStateChange` writes `userId` without bumping — deliberately,
 * because it fires on every cold load with the same id the first read is about
 * to write, and discarding on that would put a second round trip in front of
 * every page load. `attemptRead` therefore checks the session by **value**
 * against what the listener holds, and the stamps by this counter. Neither
 * check catches the other's case; both are load-bearing.
 */
let generation = 0
/**
 * What a read did with what it learned, which is the only thing its caller has
 * to act on.
 *
 * - `published` — it wrote and notified. Includes a read that *threw*: a
 *   failure is an answer the guard draws, and it notified on the way out.
 * - `retry` — the generation moved, so it dropped its answer and the cache may
 *   now hold nothing at all. Somebody has to ask again, and it will not be the
 *   guard's effect: the write's own `notify` reached it while this read still
 *   held the slot.
 * - `superseded` — `onAuthStateChange` wrote a newer session underneath. The
 *   difference from `retry` is what the cache is left holding: a decided
 *   session, never an empty one, because `writeSession` leaves `userId` as an
 *   id or `null` and never `undefined`. So a `notify` here is guaranteed to
 *   change the snapshot's shape and re-run the effect, and re-reading directly
 *   would instead loop for as long as `getSession()` and the listener disagree.
 */
type ReadOutcome = 'published' | 'retry' | 'superseded'

let inFlight: Promise<ReadOutcome> | null = null
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
  /** PD-102 — see the module-level `gone` variable. */
  gone: boolean
  /** PD-122 — see the module-level `failed` variable. Never a `GuardState`:
   * this is the one answer that has no destination. */
  failed: boolean
}

/** What the SSR pass and the hydration render both see — see the module note on
 * server state. Frozen and shared, so those two renders agree by identity. */
const EMPTY_SNAPSHOT: GuardSnapshot = Object.freeze({
  signedIn: undefined,
  onboarding: undefined,
  unavailable: false,
  gone: false,
  failed: false,
})

let snapshot: GuardSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()

function notify(): void {
  snapshot =
    userId === undefined && onboarding === undefined && !unavailable && !gone && !failed
      ? EMPTY_SNAPSHOT
      : {
          signedIn: userId === undefined ? undefined : userId !== null,
          onboarding,
          unavailable,
          gone,
          failed,
        }
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
 * What `RouteGuard` draws, given the snapshot and the destination the decision
 * produced — `undefined` for "cannot answer yet", `null` for "stay", a string
 * for "leaving".
 *
 * A pure function rather than three conditionals inside the component, because
 * this repo has no component test framework and the branch PD-122 adds is
 * exactly the kind that reaches a rider as a dead screen if it is wrong. Here it
 * is a case in `__tests__/guard-cache.test.ts`.
 *
 * `overlay` is the boot/warm split `hasGuardBooted` names, **and it applies to
 * the splash only** — the retry is exempt, for the reason the body gives.
 * Before the first answer there is nothing on screen worth preserving and
 * nothing vetted to reveal, so the cover stands alone; after it, the shell is
 * already mounted and correct and the cover goes over the top rather than
 * tearing it down. The `leaving` case is `{ kind: 'splash', overlay: false }` on
 * purpose — the screen underneath is the one the rider is being sent away from.
 */
export type GuardView = {
  /** `children` — allowed. `splash` — deciding. `retry` — the read threw. */
  kind: 'children' | 'splash' | 'retry'
  /**
   * Whether `children` stay mounted underneath the cover.
   *
   * **What the tests assert is this value, not the tree.** Nothing here can see
   * whether `RouteGuard` honoured it — the repo has no component test framework
   * — so an edit that keeps `overlay: false` while leaving `children` in the
   * tree behind a CSS-only cover reinstates the tab-order defect with every
   * test green. The one line that carries it is `RouteGuard`'s ternary.
   */
  overlay: boolean
}

export function resolveGuardView(
  state: GuardSnapshot,
  destination: string | null | undefined
): GuardView {
  if (destination) return { kind: 'splash', overlay: false }
  if (destination === null) return { kind: 'children', overlay: false }

  // Only while genuinely undecided: a rejection that still left enough to
  // decide from — the session read, the stamps thrown away on a path that does
  // not need them — routes normally rather than stopping the rider.
  //
  // **The retry never overlays, warm or cold, and that is not a stylistic
  // choice.** The splash may overlay because it holds nothing focusable and is
  // up for a frame or two; the retry holds the one control the rider is meant
  // to press and is up until they press it. Left mounted underneath, the shell
  // keeps its place in the tab order and the accessibility tree behind an
  // opaque cover — Tab twice and focus is on a `Navbar` link the rider cannot
  // see, Enter navigates an app that has just said it could not start. Not
  // rendering them is what makes that unreachable, rather than an `inert` the
  // next screen added under here has to remember to inherit.
  if (state.failed) return { kind: 'retry', overlay: false }
  return { kind: 'splash', overlay: hasGuardBooted(state) }
}

/**
 * The decision's input, or `undefined` when it cannot be answered without a
 * round trip.
 *
 * Pure, and takes the snapshot rather than reading module state, so a render can
 * call it in its body and a test can call it without one.
 *
 * **A rejected read (`failed`) is deliberately not a state here.** It answers
 * `undefined` like any other unknown, because that is what it is: no session was
 * read, so there is nothing to decide from. What changes is only what the guard
 * *draws* while undecided — see `resolveGuardView`.
 */
export function guardStateFrom(state: GuardSnapshot, pathname: string): GuardState | undefined {
  if (state.signedIn === undefined) return undefined
  if (!state.signedIn) return { kind: 'anonymous' }
  // The legal pages and the whole recovery flow, which never needed the stamps —
  // `readGuardState` skipped the round trip for them and so does this.
  if (!needsOnboardingState(pathname)) return { kind: 'session' }
  if (state.onboarding) return { kind: 'rider', ...state.onboarding }
  // Checked before `unavailable` — see the module note on why the two answer
  // the same destination but must never be confused about when to destroy.
  if (state.gone) return { kind: 'gone' }
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
    // Reaching a path this cache CAN answer releases the rejection latch. It was
    // never a verdict — the same reasoning `unavailable` carries — and the next
    // path that needs a round trip has to be free to attempt one. Without this
    // the release never happens on such a path, because `attemptedPath` does not
    // move on this return: bouncing to `/legal/terms` and back re-draws the
    // retry screen off a stale flag, with no read issued behind it.
    if (failed) {
      failed = false
      notify()
    }
    if (cached.kind !== 'unavailable') return
    // Retry the failed read once per navigation. Without this guard the retry
    // notifies, the notify re-runs the effect, and the effect retries — a render
    // loop hammering an accessor that is already answering errors.
    if (attemptedPath === pathname) return
  }
  // Same guard, for the same reason, on the rejection path (PD-122): the failure
  // notifies, the notify re-runs the guard's effect, and the effect lands back
  // here. Without this the retry the rider is being offered fires itself in a
  // loop instead. A navigation still retries, as it always did.
  if (failed && attemptedPath === pathname) return
  if (inFlight) return

  attemptedPath = pathname
  const attempt = read(pathname, generation)
  inFlight = attempt
  void attempt.then((outcome) => {
    // Nothing here is this read's to touch once the slot is somebody else's.
    // `clearGuardCache` nulls `inFlight` outright, so a later read can already
    // have taken it — and both the slot and `attemptedPath` then belong to that
    // read. Releasing either would leave its caller issuing a round trip per
    // render, which is the cost PD-111 removed.
    if (inFlight !== attempt) return
    inFlight = null
    if (outcome === 'published') return
    if (outcome === 'superseded') {
      // The listener's own write is what the cache holds now, and it is
      // decided — so this only has to be published for the effect to see it.
      notify()
      return
    }

    // PD-304 — this read discarded what it learned, so the cache is still
    // unanswered and nothing else will ask: the write's own `notify` reached
    // the guard's effect while this promise held the slot, so it returned
    // without issuing a read. Asking again directly rather than notifying and
    // trusting the effect to come back: when nothing at all is known, `notify`
    // republishes the frozen `EMPTY_SNAPSHOT`, `useSyncExternalStore` compares
    // by identity, and the effect never re-runs — a splash with no read behind
    // it, for ever. The wake-up must not depend on the snapshot changing shape.
    attemptedPath = null
    ensureGuardState(pathname)
  })

  // A read is in flight again, so the retry screen is no longer the truth —
  // back to the splash until this one answers. Notified *after* `inFlight` is
  // taken, or a listener re-entering here synchronously would issue a second
  // read of its own.
  if (failed) {
    failed = false
    notify()
  }
}

/**
 * Re-attempt a read the rider was shown a retry for (PD-122). The only writer
 * that clears the latch above without a navigation or a new session, and the
 * only one a rider can reach — a rejected read leaves the guard covering the
 * screen, so there is no navigation to be had.
 */
export function retryGuardRead(pathname: string): void {
  if (typeof document === 'undefined') return
  failed = false
  attemptedPath = null
  notify()
  ensureGuardState(pathname)
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
async function read(pathname: string, readAt: number): Promise<ReadOutcome> {
  try {
    return await attemptRead(pathname, readAt)
  } catch (error) {
    // PD-122. Neither `getSession()` nor the accessor is *supposed* to reject —
    // `session-store.ts`'s `getItem` resolves to `null` on a storage failure,
    // which is what has kept this unreachable — but the native shell puts a
    // Capacitor plugin on that path, and a plugin error is a live rejection in a
    // way `localStorage` never was. Swallowing it here is not the risk it looks
    // like: the rider gets a screen that says so and a button that re-attempts,
    // where before they got the splash for ever.
    failed = true
    // The one trace of *why*, and it is worth the line: this failure is total
    // for whoever hits it, and a rider stuck on a screen with no app behind it
    // cannot report anything a log would not say better.
    console.error('The route guard could not read the session:', error)
    notify()
    return 'published'
  }
}

async function attemptRead(pathname: string, readAt: number): Promise<ReadOutcome> {
  const supabase = createClient()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    writeSession(null)
    notify()
    return 'published'
  }

  // **Two writers can have overtaken this read, and neither check sees the
  // other's case.**
  //
  // `clearGuardCache` bumps the generation, so a sign-out that landed while
  // this was out is caught by the counter — without this, the read writes the
  // session it captured back over a cache that has just been emptied.
  if (generation !== readAt) return 'retry'
  // `onAuthStateChange` does not bump, so the counter cannot see it: auth-js
  // emits `SIGNED_OUT` on a failed token refresh — a long-idle tab, a password
  // changed on another device — with no `signOut()` behind it. Overwriting that
  // here resurrects a session the library has already removed, on a warm cache
  // that never re-reads, and the rider sits inside the app on screens whose
  // every query fails closed at RLS: empty lists, and no bounce to
  // `/auth/login`. Compared by value rather than counted, because the ordinary
  // cold load has that listener writing the same id this read is about to.
  if (userId !== undefined && userId !== session.user.id) return 'superseded'

  writeSession(session.user.id)

  if (!needsOnboardingState(pathname)) {
    notify()
    return 'published'
  }

  // The mapping — including the zero-rows case, which must not read as "not
  // onboarded" — lives in `onboardingStateFrom` so it has a test.
  // PD-304, and the check that catches the defect. Captured **here** rather
  // than when the read was issued: it is this round trip the write races, so a
  // stamp committed before the RPC is sent is already *in* the answer, and only
  // one landing after it is stale. Taking `readAt` for this instead would
  // discard a correct answer and pay for a second round trip to learn the same
  // thing.
  const stampsAt = generation

  const state = onboardingStateFrom(
    await supabase.rpc('my_onboarding_state').maybeSingle<OnboardingState>()
  )

  if (generation !== stampsAt) return 'retry'

  if (state.kind === 'rider') {
    onboarding = {
      terms_accepted_at: state.terms_accepted_at,
      onboarding_completed_at: state.onboarding_completed_at,
      has_username: state.has_username,
    }
    unavailable = false
    gone = false
  } else if (state.kind === 'gone') {
    // Task 7.1 (`client-session-storage`'s ADDED requirement) — the account
    // this session names no longer exists, and destroying it is this
    // branch's job, not something left for the rider to trigger by pressing
    // Sign out on an account that is not there to sign out of.
    onboarding = undefined
    unavailable = false
    gone = true
    await destroySessionForDeletedAccount()
  } else {
    onboarding = undefined
    unavailable = true
    gone = false
  }

  notify()
  return 'published'
}

/**
 * The local half of task 7.1, run once per device the moment it discovers
 * its own account is gone — never gated on the rider choosing to sign out,
 * because the account they would be signing out of does not exist to ask.
 *
 * **Deliberately not a call into `lib/actions/auth.ts`'s `signOut()`, and
 * deliberately not `supabase.auth.signOut()` either — measured, not assumed.**
 * Both were tried first. `signOut()` (the action) is out for the reason its
 * own doc comment states elsewhere: it imports `clearGuardCache` from *this*
 * file, so importing it back here would be a cycle, and it calls
 * `clearGuardCache()`, which erases the `gone` state this function's caller
 * is about to set. The SDK's own `supabase.auth.signOut()` looked like the
 * fix for that — until traced through the installed `@supabase/auth-js`
 * rather than assumed: `_signOut` treats a 401/403/404 from the revoke
 * endpoint (exactly what an already-deleted account returns) as "nothing to
 * revoke" and still calls `_removeSession()`, which `await`s
 * `_notifyAllSubscribers('SIGNED_OUT', null)` — and that call lands
 * *synchronously inside this function's own await*, on the very listener
 * `attachGuardAuthListener` installed in this module. That listener resets
 * `gone` to `false` and writes `userId = null` before this function's own
 * `await` returns, so by the time `read()`'s caller reaches its `notify()`,
 * `gone` has already been wiped back to `anonymous` — the rider still ends
 * up correctly signed out, but on plain `/auth/login` instead of
 * `/auth/login?error=profile_unavailable`, and only by accident of which
 * write happened to run last.
 *
 * So this clears only what does not depend on a network round trip to the
 * revoke endpoint, and it is enough: `clearQueryCache` and
 * `clearRiderLocation` are synchronous, `clearSessionStore` sweeps the
 * *persisted* storage directly (no SDK call needed — task 7.1's "does not
 * need the network"), and the SDK's own in-memory session is left to expire
 * on its own. That residual is bounded and already accepted —
 * `deletion-privileged-execution`'s "a residual access token can read for at
 * most its remaining lifetime" describes exactly this window, and it closes
 * for real the moment the rider signs in again, which unconditionally
 * overwrites `currentSession` regardless of what was there before.
 */
async function destroySessionForDeletedAccount(): Promise<void> {
  clearQueryCache()
  clearRiderLocation()
  await clearSessionStore()
}

/** Does not notify — every caller either notifies once afterwards or is itself
 * a notifying entry point, so a session write and the stamp write it precedes
 * cost one render rather than two. */
function writeSession(next: string | null): void {
  if (userId !== next) {
    // A different rider — or none — so the stamps belong to somebody else.
    onboarding = undefined
    unavailable = false
    gone = false
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
    gone = false
    // A rejected read is released here too (PD-122), and for the same reason: a
    // fresh session is exactly when re-attempting is worth it.
    failed = false
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
 * Drop the stamps, keeping the session. For the two remaining onboarding
 * writes — `setUsername` and `acceptTerms` — each of which changes a field the
 * decision reads. `setUsername` now carries the terminal call: since PD-286
 * dropped the location step it commits the completion stamp itself, in the
 * same submit as the username write, so this fires once after both rather
 * than at a separate final step.
 *
 * Invalidation rather than a patch, even though each of those knows what it just
 * made true: the stamps are timestamps this side never sees, so a patch would
 * have to fabricate them, and a fabricated value in a cache is the unlabelled
 * guess CLAUDE.md's working principles exist to prevent. The cost is one round
 * trip at each point in a once-per-account flow.
 *
 * Without it a rider finishes a step and the guard, reading the stamp it cached
 * a moment earlier, sends them straight back into it.
 */
export function invalidateOnboardingState(): void {
  if (typeof document === 'undefined') return
  generation += 1
  onboarding = undefined
  unavailable = false
  gone = false
  failed = false
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
  generation += 1
  userId = undefined
  onboarding = undefined
  unavailable = false
  gone = false
  failed = false
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
  generation = 0
  userId = undefined
  onboarding = undefined
  unavailable = false
  gone = false
  failed = false
  attemptedPath = null
  inFlight = null
  subscribed = false
  snapshot = EMPTY_SNAPSHOT
  listeners.clear()
}
