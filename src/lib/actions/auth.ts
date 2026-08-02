'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  loginSchema,
  newPasswordFormSchema,
  resetRequestSchema,
  signUpSchema,
} from '@/lib/validation/auth'

export type ActionState = { error: string | null }

export const emptyActionState: ActionState = { error: null }

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

  if (error) return { error: error.message }
  if (!data.user) return { error: 'Could not create that account. Try again.' }

  // Decision #6: email confirmation is off, so the session is live here and the
  // consent record can be written immediately. It is stored rather than kept in
  // form state because it has to outlive the request that collected it.
  await supabase
    .from('profiles')
    .update({ terms_accepted_at: new Date().toISOString() })
    .eq('id', data.user.id)

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

  return { error: null }
}

export async function updatePassword(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = newPasswordFormSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Reaching this page without a recovery session means the link was never
  // exchanged — updateUser would otherwise fail with a less useful message.
  if (!user) return { error: 'That reset link has expired. Request a new one.' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

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
