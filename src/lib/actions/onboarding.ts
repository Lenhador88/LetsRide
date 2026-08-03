'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUsernameTaken } from '@/lib/data/profile'
import { locationSchema, usernameSchema } from '@/lib/validation/profile'
import type { ActionState } from '@/lib/actions/auth'

/**
 * Live availability check for the username field. Advisory only — it can go
 * stale between the keystroke and the submit, which is why setUsername still
 * handles the unique violation.
 */
export async function checkUsernameAvailability(
  value: string
): Promise<{ available: boolean; error: string | null }> {
  const parsed = usernameSchema.safeParse(value)
  if (!parsed.success) return { available: false, error: parsed.error.issues[0].message }

  const taken = await isUsernameTaken(parsed.data)
  return { available: !taken, error: taken ? 'That username is taken.' : null }
}

export async function setUsername(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = usernameSchema.safeParse(formData.get('username'))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // .select() so a zero-row update is distinguishable from a successful one.
  // PostgREST reports no error when an update matches nothing, and the proxy
  // reads a missing profile row as "not onboarded" — so without this the rider
  // is redirected back to step 1 forever while every screen reports success.
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ username: parsed.data })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    // 23505 is the unique index on lower(username). Two riders can both pass
    // the availability check on the same name in the same instant; this is the
    // check that actually decides, so it must produce the field message rather
    // than a raw Postgres error.
    if (error.code === '23505') return { error: 'That username is taken.' }
    // 23514 is a CHECK constraint — charset, length, or the reserved denylist.
    // Only reachable if something bypassed the schema above.
    if (error.code === '23514') return { error: 'That username is not available.' }
    return { error: 'Could not save that username. Try again.' }
  }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  redirect('/onboarding/location')
}

export async function setLocation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = locationSchema.safeParse(formData.get('location'))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Location is the last step, so completion is stamped here. The database
  // trigger refuses the stamp unless username and location are both set, which
  // is what makes the wizard genuinely non-skippable (decision #5) rather than
  // merely non-skippable in the UI.
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ location: parsed.data, onboarding_completed_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not save that. Try again.' }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  redirect('/postcards')
}
