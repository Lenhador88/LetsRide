import { RIDE_JOIN_PATH } from '@/lib/routes'
import type { OnboardingState } from '@/types'

/**
 * Where a rider is allowed to be — the client-side replacement for `proxy.ts`'s
 * routing decisions (task 5.1).
 *
 * ## What moved, and what did not
 *
 * `proxy.ts` was never a security boundary and this is not one either. RLS is,
 * and group 1 finished the job of putting every rule this file reads about into
 * the database: `023` refuses content writes from a rider with no consent stamp,
 * `003` and `012` own the completion invariants, and `025` means the client
 * cannot even read the two stamps except through a `security definer` accessor.
 * A rider who defeats this guard reaches a screen whose every query returns
 * nothing. That is what makes moving it to the client an honest change rather
 * than a downgrade — and it is exactly what task 6.1 asks to be audited.
 *
 * What this owns is **where to send someone**, which is a product decision about
 * dead ends, not about permission. Decision #5: onboarding is required and not
 * skippable, and an abandoned signup resumes where it left off.
 *
 * ## Why the decision is a pure function
 *
 * `proxy.ts` interleaved reading state with deciding on it, so none of its
 * branches could be tested — and it carries five comments explaining traps
 * (redirect loops, the `!state` case, step 2 before step 1) that were found by
 * reasoning rather than by a failing test. Splitting the read from the decision
 * makes every one of those a case in `__tests__/guard.test.ts`.
 */

/**
 * A denylist of public paths, not an allowlist of protected ones. Decision #1 is
 * that everything requires a session, so a new route must be *added* here to
 * become public — the old `protectedPaths` allowlist meant forgetting to list a
 * route silently exposed it.
 *
 * /legal/* is the one deliberate exception to no-anonymous-access (Q6): the
 * terms and privacy pages have to be readable before signup completes, and they
 * are static copy with no data access.
 */
export const PUBLIC_PATHS = [
  '/',
  '/auth/login',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/callback',
  // Confirms a signup from an emailed token_hash, so it is reached with no
  // session by definition — the account is being confirmed, not signed in.
  // Deliberately NOT in AUTH_ENTRY_PATHS below: a rider who already holds a
  // session may still be confirming a second device's link, and bouncing them
  // would spend the token with nothing to show for it.
  '/auth/confirm',
  // The ride invite link's landing route (`091`, PD-330) — the first public
  // path that is not an auth screen or static copy, and the only opening this
  // change makes to a denylist that exists to keep decision #1 true by default.
  //
  // **It is public so it can HOLD a credential, never so it can SHOW
  // anything.** The screen behind it renders no ride data at all without a
  // session: the preview RPC needs `auth.uid()` for its block check and its
  // participation-gate check, so there is nothing to render before a session
  // exists and nothing anonymous to leak. What the page needs is to *mount*, so
  // it can stash the token before the rider is sent through sign-up.
  //
  // **It is in `needsOnboardingState` below as well, and that is not
  // duplication** — see that function.
  RIDE_JOIN_PATH,
]

/**
 * Signed-in riders are bounced away from these two only. Notably NOT
 * /auth/reset-password: a Supabase recovery link establishes a session before
 * landing there, so bouncing every /auth/* path sent the user to the home screen
 * with their old password still active and no error (Q1).
 */
export const AUTH_ENTRY_PATHS = ['/auth/login', '/auth/signup']

export type GuardState =
  /** No session. */
  | { kind: 'anonymous' }
  /**
   * A session, on a path that does not need the onboarding stamp — the legal
   * pages and the whole recovery flow. `readGuardState` returns this instead of
   * spending a round trip, exactly as `proxy.ts` skipped its profile read.
   *
   * It is its own state rather than being folded into `unavailable` on the
   * reasoning that the branch order makes them equivalent. It does *not*: if a
   * path that genuinely needs the stamp ever reaches `resolveDestination` with
   * this, the correct answer is to fail closed, and only a distinct state can
   * say so. Relying on two files agreeing about branch order is how a guard
   * quietly stops guarding.
   */
  | { kind: 'session' }
  /**
   * A session, but the onboarding accessor did not answer. Deliberately its own
   * state rather than being folded into "not onboarded" — see `resolveDestination`.
   */
  | { kind: 'unavailable' }
  /**
   * A session naming an account that no longer exists — the onboarding
   * accessor answered with ZERO ROWS rather than an error (PD-102,
   * `client-session-storage`'s ADDED "a session whose account no longer
   * exists SHALL be destroyed"). Deliberately a fourth state rather than
   * folded into `unavailable`, even though `resolveDestination` sends both to
   * the same place: `unavailable` can be a transient read failure — a deploy
   * mismatch, a dropped connection — and must never trigger destroying the
   * rider's local session; `gone` can only mean the row is truly absent,
   * which is the one case `guard-cache.ts`'s `read()` is allowed to react to
   * that way. Collapsing the two would either destroy a signed-in rider's
   * session on an ordinary network hiccup, or leave a deleted account's
   * session sitting on a device forever — see `onboardingStateFrom`.
   */
  | { kind: 'gone' }
  | ({ kind: 'rider' } & OnboardingState)

export function isPublicPath(pathname: string): boolean {
  // `/legal/` with the trailing slash, not `startsWith('/legal')` — the loose
  // prefix also matches `/legalfoo`. Harmless while nothing routes there, but a
  // public rider profile at `/[username]` is a plausible next route, and
  // `legalbeagle` is a legal username under 003's rules.
  return (
    PUBLIC_PATHS.includes(pathname) || pathname === '/legal' || pathname.startsWith('/legal/')
  )
}

/**
 * `null` means "stay here". A string is the path to replace the current one
 * with.
 *
 * Every branch below is `proxy.ts`'s, in its order, for the reasons its comments
 * gave. The order is load-bearing in three places and each is marked.
 */
export function resolveDestination(pathname: string, state: GuardState): string | null {
  const isAuthEntry = AUTH_ENTRY_PATHS.includes(pathname)
  const isOnboarding = pathname.startsWith('/onboarding')
  const isPublic = isPublicPath(pathname)

  if (state.kind === 'anonymous') {
    // `/` is public, so an anonymous rider landing on the splash is *allowed*
    // to be there — but there is nothing to see. The server version could not
    // express this: `/` was a server page that redirected, so the guard never
    // had to have an opinion. Now the page renders the splash and this is what
    // sends them on.
    if (pathname === '/') return '/auth/login'
    return isPublic ? null : '/auth/login'
  }

  // Public paths that are not a way back into signup need no onboarding state,
  // so `readGuardState` skips the round trip entirely for them. That covers the
  // legal pages and the whole recovery flow.
  if (state.kind === 'session') {
    // Fail closed if the caller skipped the read on a path that needed it —
    // see the type's own note. `needsOnboardingState` and this must agree, and
    // this is the half that notices when they stop.
    return needsOnboardingState(pathname) ? '/auth/login?error=profile_unavailable' : null
  }

  // A read that did not answer and a genuinely un-onboarded rider are different
  // states, and treating them the same is how a deploy mismatch turns into a
  // redirect loop: a missing function answers PGRST202 and every authenticated
  // route would otherwise bounce into a wizard that cannot help. Fail closed and
  // visibly rather than into it.
  //
  // `gone` is the accessor returning ZERO ROWS for a caller with no `profiles`
  // row — split out from this branch as its own `GuardState` (PD-102), but
  // routed to the exact same destination: read as "not onboarded" either way
  // would send the rider to the consent prompt, where `accept_terms()` has no
  // row to update, returns NULL, and fails every submit — a trap with no exit.
  // `023` and the account-deletion proposal both name deleting a `profiles`
  // row without its `auth.users` row as the thing that makes this reachable —
  // account deletion is now the routine way, not the deploy-mismatch case
  // `unavailable` was written for.
  if (state.kind === 'unavailable' || state.kind === 'gone') {
    // The auth entry paths must fall through rather than redirect. They are
    // public but still reach this branch (a signed-in rider is normally bounced
    // off them), so sending /auth/login to /auth/login is an infinite loop — and
    // it would fire on exactly the failure this branch exists to survive,
    // locking every signed-in rider out with no way to sign out.
    if (isAuthEntry) return null
    return '/auth/login?error=profile_unavailable'
  }

  // Consent comes before the wizard, because 023 refuses to stamp completion
  // while the consent stamp is NULL. Q11 chose a prompt over a backfill: a
  // fabricated consent record is worse than a missing one.
  //
  // This said a rider who signed up through the current flow never sees the
  // screen, "because signUp records consent the instant the account exists", so
  // in practice only accounts predating that write reach it. **That is wrong
  // while email confirmation is on**, which — measured 2026-08-06 — it is:
  // `signUp` gets no session back, cannot call `accept_terms()`, and returns
  // without a stamp. So this branch is not a legacy path, it is the *ordinary*
  // one every new rider takes, and it is what stops the missing stamp from
  // becoming a rider who is signed in and cannot post.
  if (!state.terms_accepted_at) {
    return pathname === '/onboarding/terms' ? null : '/onboarding/terms'
  }

  if (!state.onboarding_completed_at) {
    // Username is now the only step (PD-286 dropped location) — completion is
    // stamped by `setUsername` itself, so there is no further field to resume
    // into. Completion is stored, so editing your profile later never
    // re-gates you.
    const resume = '/onboarding/username'

    if (isOnboarding) {
      // /onboarding/terms is past for this rider, so it redirects on to the
      // resume step; the resume path itself stays put. Everything else under
      // /onboarding — including a deleted step's URL surviving in a bookmark,
      // a stale tab, or a native shell restoring its last path — resolves to
      // the resume step rather than rendering a 404 with the guard insisting
      // the rider belongs there. `isOnboarding` is a prefix test, so this
      // catch-all also covers whatever step this wizard gains or loses next.
      if (pathname === '/onboarding/terms') return resume
      if (pathname === resume) return null
      return resume
    }
    return resume
  }

  if (isOnboarding || isAuthEntry || pathname === '/') {
    // Postcards is the home screen; /dashboard was deleted with the feed that
    // replaced it.
    return '/postcards'
  }

  return null
}

/**
 * Does this path need the onboarding accessor at all?
 *
 * Split out so the guard can skip a round trip on the legal pages and the whole
 * recovery flow, exactly as `proxy.ts` did — and so the skip is testable rather
 * than being an early `return` buried in the middle of the decision.
 *
 * **This is a different question from `isPublicPath`, and the first line is why
 * a public route has to be named here as well.** *May this be reached without a
 * session* and *must decision #5 be evaluated here* are separate, and
 * `!isPublicPath(pathname) → true` means adding a route to `PUBLIC_PATHS` alone
 * silently answers this one `false`: the stamps are never read, the state stays
 * `{ kind: 'session' }`, and `resolveDestination` answers "stay". For the legal
 * pages and the recovery flow that is correct and deliberate. For the invite
 * landing route it is the feature's main flow dead-ending — a rider who has
 * just signed up sits on the preview tapping a Join button that raises
 * `check_violation` every time, with no route into the wizard and nothing on
 * screen saying why.
 */
export function needsOnboardingState(pathname: string): boolean {
  if (!isPublicPath(pathname)) return true
  if (AUTH_ENTRY_PATHS.includes(pathname)) return true
  // A signed-in rider on an invite link must still be sent to their resume step
  // — `023` refuses the claim's write until both stamps are set, so the wizard
  // is the only thing standing between them and the ride. See the note above.
  if (pathname === RIDE_JOIN_PATH) return true
  // The splash has to know where to send a signed-in rider, which is the resume
  // step when they are mid-wizard.
  return pathname === '/'
}

/**
 * What `my_onboarding_state()` answered, mapped to a `GuardState`.
 *
 * Its own function because **`data: null, error: null` is a distinct case that
 * must not read as "not onboarded"**, and that is the single most consequential
 * line in this file. The accessor returns ZERO ROWS for a caller with no
 * `profiles` row, and PostgREST reports zero rows exactly that way. Read as
 * un-onboarded, the rider goes to the consent prompt, where `accept_terms()` has
 * no row to update, returns NULL, and fails every submit — a trap with no exit.
 *
 * **Zero rows and an error are no longer the same `GuardState` (PD-102).**
 * `.maybeSingle()` answers `{ data: null, error: null }` for zero rows and
 * `{ data: null, error: <PostgrestError> }` for a read that genuinely failed —
 * a missing function, a dropped connection. The first can only mean the
 * account is gone; the second says nothing about whether it still exists.
 * `resolveDestination` sends both to the same place, but `guard-cache.ts`'s
 * `read()` must not react to them the same way — destroying a signed-in
 * rider's local session on an ordinary network hiccup would be `unavailable`'s
 * failure mode turned into a much worse one. Splitting them here is what
 * makes that distinction a tested branch rather than a `read()`-local guess.
 */
export function onboardingStateFrom(result: {
  data: OnboardingState | null
  error: unknown
}): GuardState {
  if (result.error) return { kind: 'unavailable' }
  if (!result.data) return { kind: 'gone' }
  return { kind: 'rider', ...result.data }
}
