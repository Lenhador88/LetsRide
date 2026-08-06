import { resolveSupabase } from '@/lib/supabase/resolve'
import { clearQueryCache } from '@/lib/query'
import { clearSessionStore } from '@/lib/supabase/session-store'
import { RECOVERY_EXPIRED_MESSAGE, consumePasswordResetGrant } from '@/lib/auth/recovery'
import type { ActionState } from '@/lib/actions/state'
import {
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

  // The route guard decides the real destination — an un-onboarded rider is
  // sent to their resume step rather than the home screen.
  return { error: null, redirectTo: '/postcards' }
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    acceptedTerms: formData.get('acceptedTerms') === 'on',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    // Spec §Risks accepts that with email confirmation off (decision #6) the
    // duplicate-signup case is unavoidably explicit — Supabase's usual
    // mitigation, returning success and emailing the real owner, needs
    // confirmation on. So this leak is a known consequence of #6, not an
    // oversight, and it closes when #6 is revisited. Everything else gets one
    // message rather than Supabase's raw copy.
    const alreadyRegistered = error.message.toLowerCase().includes('already registered')
    return {
      error: alreadyRegistered
        ? 'That email is already registered. Try signing in instead.'
        : 'Could not create that account. Try again.',
    }
  }
  if (!data.user) return { error: 'Could not create that account. Try again.' }

  // Decision #6: email confirmation is off, so the session is live here and the
  // consent record can be written immediately. It is stored rather than kept in
  // form state because it has to outlive the request that collected it.
  //
  // Through the RPC rather than an UPDATE because 021 revokes the client's
  // UPDATE grant on the column. That is not a workaround for the revoke, it is
  // the point of it: the timestamp is now originated by the database, so a
  // back-dated first write is impossible rather than merely reverted. 012's
  // trigger could only ever replace a value the client supplied.
  const { data: consent, error: consentError } = await supabase.rpc('accept_terms')

  // Checked rather than fire-and-forget. This call only succeeds because #6
  // leaves the session live at this point; turn email confirmation on and it
  // runs unauthenticated, is refused, and the rider would otherwise finish
  // onboarding with no consent record while the screen reported success.
  if (consentError || !consent) {
    return { error: 'Your account was created but we could not record your consent. Sign in to continue.' }
  }

  return { error: null, redirectTo: '/onboarding/username' }
}

export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // `window.location.origin`, not the `origin` request header this read before
  // the migration. There is no request here any more — this runs in the
  // browser, where the header was only ever an indirect way of asking the same
  // question. It is also the more accurate of the two: `origin` is absent on a
  // same-origin GET in some browsers, and the empty-string fallback this used
  // to take would have produced `/auth/callback` as the recovery link.
  const origin = window.location.origin
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
  await clearSessionStore()
  return { error: null, redirectTo: '/auth/login' }
}
