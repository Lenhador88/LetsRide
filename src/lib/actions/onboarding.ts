import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidateOnboardingState } from '@/lib/auth/guard-cache'
import { isUsernameTaken } from '@/lib/data/profile'
import { locationSchema, usernameSchema } from '@/lib/validation/profile'
import { consentSchema } from '@/lib/validation/auth'
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

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: null, redirectTo: '/auth/login' }

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

  // `has_username` is one of the three fields the route guard's decision reads,
  // and it now holds the answer from before this write. Left stale, the guard
  // sees step 1 as unfinished and bounces the rider straight back to it from
  // the step 2 this redirect is about to send them to.
  invalidateOnboardingState()

  return { error: null, redirectTo: '/onboarding/location' }
}

/**
 * The consent prompt for a rider whose `terms_accepted_at` is NULL (Q11).
 *
 * Deliberately not a step in the wizard's pagination. `signUp` records consent
 * the moment the account exists, so a rider who signed up through the current
 * flow never sees this screen — it exists for the accounts that predate that
 * write, of which there are four, all documented in docs/HANDOFF.md. Building
 * it as a flow would be building a rollout for a population of one.
 *
 * It must exist before 023 applies: that migration refuses content writes from
 * a rider with no consent stamp, and no migration may write one on a rider's
 * behalf.
 */
export async function acceptTerms(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = consentSchema.safeParse({
    acceptedTerms: formData.get('acceptedTerms') === 'on',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: null, redirectTo: '/auth/login' }

  const { data: accepted, error } = await supabase.rpc('accept_terms')
  if (error || !accepted) return { error: 'Could not record that. Try again.' }

  // Same reason as `setUsername` — the stamp the guard cached says NULL, which
  // is what sent the rider to this screen in the first place.
  invalidateOnboardingState()

  // The route guard decides the real destination, the same way signIn leaves
  // it to. Most riders who reach this screen are already fully onboarded — the prompt
  // exists for accounts whose consent predates the write, not for new ones — so
  // naming a wizard step here would send a finished rider to step 1 and rely on
  // the guard to undo it.
  return { error: null, redirectTo: '/postcards' }
}

export async function setLocation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = locationSchema.safeParse(formData.get('location'))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: null, redirectTo: '/auth/login' }

  // Location is the last step, so completion is stamped here — and both halves
  // go in one RPC because 021 revokes the client's UPDATE grant on the stamp.
  // Splitting it into "write location, then stamp completion" would put a
  // window between them in which a failure leaves a rider with a location and
  // no completion, which is precisely the resumable-wizard state decision #5
  // relies on being accurate.
  //
  // The function refuses the stamp unless username, location and consent are
  // all set. It has to check that itself rather than lean on 003's and 023's
  // triggers: those short-circuit on `current_user <> 'authenticated'`, and
  // inside a security definer function current_user is the owner.
  const { data: completed, error } = await supabase.rpc('complete_onboarding', {
    p_location: parsed.data,
  })

  if (error) {
    // 23514 is the function's own guard — username or consent still missing.
    // Reachable by deep-linking to step 2, which the route guard also covers,
    // so this is the second line rather than the first.
    if (error.code === '23514') return { error: 'Finish the earlier steps first.' }
    return { error: 'Could not save that. Try again.' }
  }
  if (!completed) return { error: 'Your profile could not be found. Sign in again.' }

  // Same reason again, and this is the one that would be most visible: without
  // it the guard reads a NULL completion stamp and returns the rider to the
  // wizard they have just finished.
  invalidateOnboardingState()

  return { error: null, redirectTo: '/postcards' }
}
