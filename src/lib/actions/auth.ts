import { resolveSupabase } from '@/lib/supabase/resolve'
import { canonicalOrigin } from '@/lib/origin'
import { clearQueryCache } from '@/lib/query'
import { clearGuardCache, invalidateOnboardingState } from '@/lib/auth/guard-cache'
import { clearRiderLocation } from '@/lib/location/rider-location'
import { clearStashedInviteToken, takeStashedInviteToken } from '@/lib/invites/pending-token'
import { routes } from '@/lib/routes'
import { clearSessionStore } from '@/lib/supabase/session-store'
import { edgeFunctionErrorCode } from '@/lib/supabase/functions'
import { RECOVERY_EXPIRED_MESSAGE, consumePasswordResetGrant } from '@/lib/auth/recovery'
import { isOnline } from '@/lib/query/connectivity'
import type { ActionState } from '@/lib/actions/state'
import {
  deleteAccountSchema,
  loginSchema,
  newPasswordFormSchema,
  resetRequestSchema,
  signUpSchema,
} from '@/lib/validation/auth'

export type { ActionState } from '@/lib/actions/state'

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  // Deliberately does not distinguish "no such account" from "wrong password".
  // Either message tells an attacker which addresses are registered.
  if (error) return { error: 'That email and password do not match an account.' }

  // **A stashed invite token is consumed here** (`091`, PD-330), for the same
  // reason `setUsername` consumes it: the rider signed in *because of* a link,
  // and landing them on `/postcards` with a live token in `sessionStorage` and
  // nothing reading it is the flow dead-ending quietly. An existing rider never
  // runs the wizard, so this is the only place their detour comes back.
  //
  // **It is a navigation and never a claim.** The rider who signs in is not
  // necessarily the rider who opened the link, so they are returned to the
  // preview and must tap — see `claimRideInviteLink`.
  const invite = takeStashedInviteToken()

  // The route guard decides the real destination — an un-onboarded rider is
  // sent to their resume step rather than the home screen, from either of these.
  return { error: null, redirectTo: invite ? routes.joinRide(invite) : '/postcards' }
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    acceptedTerms: formData.get('acceptedTerms') === 'on',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  // `canonicalOrigin()`, matching `requestPasswordReset` below rather than
  // leaving this unset. With email confirmation on (the live setting, see the
  // comment on the `!data.session` branch), GoTrue's confirmation link is the
  // entire rest of this flow — without `emailRedirectTo` it falls back to the
  // project's Site URL rather than wherever this rider actually signed up.
  // `next=/postcards` lands a confirmed rider on any authenticated route; the
  // route guard takes it from there; `accept_terms()` has not run yet at that
  // point (no session existed to run it with), so the guard's own consent
  // check sends them to `/onboarding/terms`, which stamps it once there.
  //
  // It is the canonical origin rather than the runtime one because this URL
  // leaves the app in an email. In the shell the runtime origin is
  // `https://localhost`, which is not on GoTrue's allowlist — and an unlisted
  // `redirect_to` is **discarded silently**, path and all, landing the rider on
  // the app root with the error in a fragment nothing reads. Measured against
  // the live PROD auth server 2026-08-12; `src/lib/origin.ts` carries the probe
  // and the readings.
  const origin = canonicalOrigin()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/postcards` },
  })

  if (error) {
    // Spec §Risks accepted an explicit duplicate-signup message as the price of
    // email confirmation being off: Supabase's usual mitigation — returning
    // success and emailing the real owner — needs confirmation on. With it on,
    // GoTrue applies that mitigation itself and returns success with an empty
    // `identities` array instead of this error, so the branch below is a
    // fallback for the confirmation-off configuration rather than the path a
    // duplicate normally takes. Either way the address is never confirmed to a
    // stranger by the `sent` branch further down.
    const alreadyRegistered = error.message.toLowerCase().includes('already registered')
    return {
      error: alreadyRegistered
        ? 'That email is already registered. Try signing in instead.'
        : 'Could not create that account. Try again.',
    }
  }
  if (!data.user) return { error: 'Could not create that account. Try again.' }

  // **The session decides the flow, and it is read rather than assumed.**
  //
  // This used to go straight to `accept_terms()` on the strength of decision
  // #6 ("email confirmation is off, so the session is live here"). #6 describes
  // an intent, not a fact: confirmation is a GoTrue dashboard setting with no
  // file behind it (docs/ENVIRONMENTS.md §Auth configuration), so nothing in
  // this repo makes it true and nothing notices when it changes. Measured
  // 2026-08-06 against the live project, `/auth/v1/settings` reports
  // `mailer_autoconfirm: false` — it is ON, and has been for every signup this
  // database has seen.
  //
  // With it on, `signUp` returns a user and **no session**. The RPC below then
  // runs as `anon`, which holds no EXECUTE on it (021), so it was refused and
  // the rider was told their consent could not be recorded and to "sign in to
  // continue" — advice that cannot work, because sign-in is refused until the
  // address is confirmed. One account on this database is stuck in exactly that
  // state.
  //
  // Reading the session makes the flow correct under either setting, which is
  // what #6 needs anyway: it is documented as temporary and must be revisited
  // before launch.
  if (!data.session) {
    // Consent is not lost by returning here — the rider ticked the box, and the
    // route guard sends any signed-in rider with a NULL stamp to
    // `/onboarding/terms` ahead of the wizard, which stamps it through the same
    // RPC once there is a session to run it with. `023` refuses their content
    // writes until then, so the gap is closed by the database and not by trust.
    return { error: null, sent: true }
  }

  // The consent record is stored rather than kept in form state because it has
  // to outlive the request that collected it.
  //
  // Through the RPC rather than an UPDATE because 021 revokes the client's
  // UPDATE grant on the column. That is not a workaround for the revoke, it is
  // the point of it: the timestamp is now originated by the database, so a
  // back-dated first write is impossible rather than merely reverted. 012's
  // trigger could only ever replace a value the client supplied.
  const { data: consent, error: consentError } = await supabase.rpc('accept_terms')

  // Checked rather than fire-and-forget: a rider who finished onboarding with
  // no consent record would have been told nothing was wrong.
  if (consentError || !consent) {
    return { error: 'Your account was created but we could not record your consent. Sign in to continue.' }
  }

  // The fourth writer of a stamp the route guard caches, and the one that is
  // easy to miss because the other three are in `onboarding.ts`. `signUp`
  // establishes the session before it stamps consent, so the guard — which is
  // sitting on `/auth/signup`, a path that needs the stamps — can read
  // `terms_accepted_at` as NULL in the window between the two. Cached, that
  // sends the rider who just ticked the box to the consent prompt.
  //
  // Only reachable with email confirmation off; with it on this branch is never
  // taken, because there is no session to run `accept_terms()` with.
  invalidateOnboardingState()

  return { error: null, redirectTo: '/onboarding/username' }
}

export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // `canonicalOrigin()`, not the `origin` request header this read before the
  // migration. There is no request here any more — this runs in the browser,
  // where the header was only ever an indirect way of asking the same question.
  // It is also the more accurate of the two: `origin` is absent on a
  // same-origin GET in some browsers, and the empty-string fallback this used
  // to take would have produced `/auth/callback` as the recovery link.
  //
  // On the web `canonicalOrigin()` *is* the runtime origin, which is what keeps
  // recovery working from a per-deployment preview alias. In the shell it is the
  // configured host, because a recovery link built from `https://localhost` is
  // discarded by GoTrue and the rider is stranded — `src/lib/origin.ts`.
  const origin = canonicalOrigin()
  const supabase = await resolveSupabase()

  // The result is not surfaced. Q13: the screen always reports that
  // instructions have been sent, so the form cannot be used to discover which
  // addresses have accounts.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
  })

  // `sent` rather than relying on the screen comparing object identity against
  // the seed value: both states are `{error: null}`, and identity survives only
  // as long as the seed is a shared singleton.
  return { error: null, sent: true }
}

export async function updatePassword(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = newPasswordFormSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()

  // A recovery link yields an ordinary session, so "is signed in" is not
  // evidence of anything here. The route guard deliberately does not bounce
  // signed-in riders away from this page (Q1), which means without this check anyone
  // holding a session — a shared device, a borrowed laptop — could set a new
  // password without knowing the old one.
  //
  // The proof is Supabase's own `amr` claim, checked in Postgres by `026`; this
  // used to be an httpOnly cookie /auth/callback set, which the client-rendered
  // shell has nowhere to keep. See lib/auth/recovery.ts.
  //
  // Consumed BEFORE the update, so the grant is spent whatever happens next.
  // One link, one reset, including when two submits race.
  if (!(await consumePasswordResetGrant(supabase))) {
    return { error: RECOVERY_EXPIRED_MESSAGE }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  // Supabase's own copy leaks implementation detail and, for some failures,
  // account state. The schema above already enforces what the rider controls.
  if (error) return { error: 'Could not update your password. Request a new link.' }

  // Q14: the recovery session is already active, so there is nothing to log
  // into — go straight in.
  return { error: null, redirectTo: '/postcards' }
}

/**
 * Signing out, and destroying everything the session left behind (task 4.5).
 *
 * **`clearQueryCache()` rather than `invalidate(EVERYTHING)`, and the
 * difference is the whole point.** Invalidating refetches, which is right for a
 * block and catastrophic here: the next rider on a shared device would watch
 * the previous rider's screens repopulate from cache while their own session
 * was still being established. Clearing resets every entry in place and bumps
 * every generation, so a response already in flight for rider A cannot land in
 * rider B's session — task 4.6.
 *
 * Signed image URLs go with it. They live nowhere but inside the cached rows
 * that hold them, so there is no second store to sweep for those — a property
 * worth stating, because a signed URL outliving the sign-out that should have
 * invalidated it would be readable for the rest of its hour.
 *
 * **`clearSessionStore()` is the second half and it was written without a
 * caller.** `supabase.auth.signOut()` removes the keys the library knows it
 * wrote *in this page load*; the store's own sweep also clears anything left by
 * a session written before a reload, which the library's in-memory bookkeeping
 * cannot see. It runs after the revocation on purpose — clearing first would
 * take the refresh token away from the call that needs it, turning every
 * sign-out into a local-only one.
 *
 * **`clearGuardCache()` is the third**, and it is the route guard's held state
 * rather than the query cache's — see `lib/auth/guard-cache.ts` for why it is
 * cleared here as well as by the `SIGNED_OUT` listener.
 *
 * **`clearStashedInviteToken()` is the fifth** (`091`, PD-330). A stashed
 * invite token is a trace and a credential at once — it came from a message
 * rather than from the rider, but leaving it behind means whoever signs in next
 * on this device inherits a spendable grant. It is a local `sessionStorage` key
 * with no user id in it, so nothing else would ever clear it, and the URL in the
 * original message is the durable copy for the rider who actually holds it.
 *
 * **`clearRiderLocation()` is the fourth**, added with the place-search
 * location provider (`src/lib/location/rider-location.ts`). It holds no user
 * id of its own to check against, so without this call a rider's resolved
 * coordinates survive this function's client-side navigation (there is no
 * page reload) into whoever signs in next on the same device.
 *
 * **The rider ends up signed out even when the revocation fails**, which is the
 * offline case 4.5 names. `signOut()` defaults to `scope: 'global'` — a network
 * call to revoke every session — and on a dead network that rejects. Falling
 * back to `scope: 'local'` discards the local session without the server's
 * agreement, which is the right trade on a device the rider is walking away
 * from: the refresh token stays live somewhere until it expires, and the device
 * in their hand is clean. The error is deliberately not surfaced; a rider who
 * pressed Sign out and is still signed in is the worse outcome by far.
 */
export async function signOut(): Promise<ActionState> {
  const supabase = await resolveSupabase()

  const { error } = await supabase.auth.signOut()
  if (error) await supabase.auth.signOut({ scope: 'local' })

  clearQueryCache()
  clearGuardCache()
  clearRiderLocation()
  clearStashedInviteToken()
  await clearSessionStore()
  return { error: null, redirectTo: '/auth/login' }
}

/**
 * Account deletion — PD-102, `account-deletion`'s re-authentication and
 * "every state is defined" requirements.
 *
 * **Offline refuses outright, before the network call, and never queues.**
 * The one write in this app that must never be optimistic (design D7, Q11) —
 * `isOnline()` rather than trusting a disabled button, because the button is
 * a UX convenience and this is the boundary a modified or stale client
 * cannot skip.
 *
 * **On success this returns exactly what `signOut()` returns, by calling
 * it** — `client-session-storage`'s own rule: "A successful deletion
 * destroys the same set as a sign-out … SHALL NOT be reimplemented alongside
 * sign-out's, because two lists of what to clear drift and only one of them
 * is exercised daily." `signOut()`'s own revocation call is expected to be
 * refused by the server here — there is no account left to revoke — and it
 * already falls back to a local-only sign-out on any error, which is exactly
 * the "revocation the server refuses is not a failed deletion" scenario.
 *
 * **The Edge Function's error codes are three, not two, and the client must
 * not fold any of them into another — reviewer finding #2, 2026-08-16.**
 *
 *   - `unauthorized` — the JWT itself was actively rejected by GoTrue, which
 *     for a token this action just used successfully to reach the function
 *     can only mean the account is already gone (D7's already-deleted case:
 *     a second device, a retry after an unseen success). Reported as
 *     success.
 *   - `reauth_required` — the session is fine and the password was missing
 *     or wrong. Reported as a retryable failure, with the account and the
 *     rider's session both untouched, per "A wrong password does not
 *     delete".
 *   - `verification_unavailable` — the function's own `getUser` call could
 *     not get a real answer from GoTrue at all (a brief outage reaching it
 *     from the Edge runtime, or GoTrue itself erroring) — this says NOTHING
 *     about whether the token or the account is valid. **It used to be
 *     indistinguishable from `unauthorized` on this endpoint, which reported
 *     a transient GoTrue hiccup as "account deleted" and signed the rider
 *     out with nothing actually removed** — the false-positive erasure
 *     reviewer finding #2 named. Reported as a retryable failure, same as
 *     `reauth_required`, and never as success.
 *
 * `edgeFunctionErrorCode` is what tells the three apart; a network failure
 * that never reached the function returns none of them and falls into the
 * generic retry message below.
 */
export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = deleteAccountSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  if (!isOnline()) {
    return { error: "You're offline — reconnect to delete your account." }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.functions.invoke('delete-account', {
    body: { password: parsed.data.password },
  })

  if (error) {
    const code = await edgeFunctionErrorCode(error)

    if (code === 'reauth_required') return { error: 'That password is incorrect.' }

    // A GoTrue call that could not complete says nothing about the account
    // or the token — reported the same as a wrong password, never as
    // success. See the header: this used to be folded into `unauthorized`.
    if (code === 'verification_unavailable') {
      return { error: 'Could not verify your account right now. Try again in a moment.' }
    }

    // `code === 'unauthorized'` falls through to the success path below — see
    // the header. Anything else (a network failure, a 500, a relay error) is
    // reported as a retryable failure with nothing deleted.
    if (code !== 'unauthorized') {
      return { error: 'Could not delete your account. Try again.' }
    }
  }

  return signOut()
}
