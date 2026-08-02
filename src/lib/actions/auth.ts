'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { RECOVERY_COOKIE } from '@/lib/auth/recovery'
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
  redirect('/dashboard')
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
  const { data: consent } = await supabase
    .from('profiles')
    .update({ terms_accepted_at: new Date().toISOString() })
    .eq('id', data.user.id)
    .select('id')
    .maybeSingle()

  // Checked rather than fire-and-forget. This write only succeeds because #6
  // leaves the session live at this point; turn email confirmation on and it
  // runs unauthenticated, is refused, and the rider would otherwise finish
  // onboarding with no consent record while the screen reported success.
  if (!consent) {
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

  // A recovery link yields an ordinary session, so "is signed in" is not
  // evidence of anything here. proxy.ts deliberately stopped bouncing signed-in
  // riders away from this page (Q1), which means without this check anyone
  // holding a session cookie could set a new password without knowing the old
  // one. The cookie is set only by /auth/callback after a successful code
  // exchange.
  const cookieStore = await cookies()
  if (!cookieStore.get(RECOVERY_COOKIE)) {
    return { error: 'That reset link has expired. Request a new one.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'That reset link has expired. Request a new one.' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  // Supabase's own copy leaks implementation detail and, for some failures,
  // account state. The schema above already enforces what the rider controls.
  if (error) return { error: 'Could not update your password. Request a new link.' }

  // One link, one reset.
  cookieStore.delete(RECOVERY_COOKIE)

  // Q14: the recovery session is already active, so there is nothing to log
  // into — go straight in.
  redirect('/dashboard')
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/auth/login')
}
