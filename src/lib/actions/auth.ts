'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  // Deliberately does not distinguish "no such account" from "wrong password".
  // Either message tells an attacker which addresses are registered.
  if (error) return { error: 'That email and password do not match an account.' }

  // proxy.ts decides the real destination — an un-onboarded rider is sent to
  // their resume step rather than the dashboard.
  redirect('/postcards')
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    acceptedTerms: formData.get('acceptedTerms') === 'on',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
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

  redirect('/onboarding/username')
}

export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const origin = (await headers()).get('origin') ?? ''
  const supabase = await createClient()

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

  const supabase = await createClient()

  // A recovery link yields an ordinary session, so "is signed in" is not
  // evidence of anything here. proxy.ts deliberately stopped bouncing signed-in
  // riders away from this page (Q1), which means without this check anyone
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
  redirect('/postcards')
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/auth/login')
}
