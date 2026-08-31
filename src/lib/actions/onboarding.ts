import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidateOnboardingState } from '@/lib/auth/guard-cache'
import { isUsernameTaken } from '@/lib/data/profile'
import { USERNAME_TAKEN_MESSAGE, checkUsername } from '@/lib/validation/profile'
import { consentSchema } from '@/lib/validation/auth'
import { takeAnyStashedInviteToken } from '@/lib/invites/pending-token'
import { routes } from '@/lib/routes'
import type { ActionState } from '@/lib/actions/auth'

/**
 * Live availability check for the username field. Advisory only — it can go
 * stale between the keystroke and the submit, which is why setUsername still
 * handles the unique violation.
 *
 * **It can also be wrong in one direction permanently**, which no amount of
 * re-checking fixes: it reads through the block-aware SELECT policy while the
 * unique index is global, so to a rider blocked by a name's holder this reports
 * "free" for a name that is not. `usernameVerdict` is what reconciles the two on
 * screen; see its header for why the fix is not here.
 */
export async function checkUsernameAvailability(
  value: string
): Promise<{ available: boolean; error: string | null }> {
  const parsed = checkUsername(value)
  if (!parsed.ok) return { available: false, error: parsed.error }

  const taken = await isUsernameTaken(parsed.username)
  return { available: !taken, error: taken ? USERNAME_TAKEN_MESSAGE : null }
}

/**
 * `setUsername`'s state, and the extra field is the submit boundary's half of
 * PD-146.
 */
export type UsernameActionState = ActionState & {
  /**
   * The exact (normalised) value the unique index refused, when it did.
   *
   * Carried separately from `error` so the screen can put the refusal on the
   * *field*, replacing the "available" the live check is still showing, rather
   * than beside the submit button contradicting it. Matching on the message
   * text would work today and break the first time the copy is edited.
   */
  taken?: string
}

export async function setUsername(
  _prev: ActionState,
  formData: FormData
): Promise<UsernameActionState> {
  // `String(... ?? '')` rather than handing the raw entry to Zod: a missing
  // field would otherwise surface Zod's own "expected string, received null"
  // at a rider, where an empty one gets the length message the field already
  // shows while they type.
  const parsed = checkUsername(String(formData.get('username') ?? ''))
  if (!parsed.ok) return { error: parsed.error }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: null, redirectTo: '/auth/login' }

  // .select() so a zero-row update is distinguishable from a successful one.
  // PostgREST reports no error when an update matches nothing, and the proxy
  // reads a missing profile row as "not onboarded" — so without this the rider
  // is redirected back to step 1 forever while every screen reports success.
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ username: parsed.username })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    // 23505 is the unique index on lower(username). Two riders can both pass
    // the availability check on the same name in the same instant; this is the
    // check that actually decides, so it must produce the field message rather
    // than a raw Postgres error.
    //
    // The race is not the only way here, and the other way is not transient:
    // the index is global while the availability check is block-aware, so a
    // rider blocked by the name's holder is told "free" every single time and
    // refused every single time (PD-146, measured through PostgREST on DEV
    // 2026-08-09 — HTTP 409, code 23505). Returning the value as well as the
    // message is what lets the field stop saying the opposite.
    if (error.code === '23505') {
      return { error: USERNAME_TAKEN_MESSAGE, taken: parsed.username }
    }
    // 23514 is a CHECK constraint — charset, length, or the reserved denylist.
    // Only reachable if something bypassed the schema above.
    if (error.code === '23514') return { error: 'That username is not available.' }
    return { error: 'Could not save that username. Try again.' }
  }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  // Username is now the last step, and this is the write that commits the
  // stamp — 075 relaxed complete_onboarding's location requirement, so it takes
  // `p_location: null` explicitly rather than a value this screen never
  // collects. The order is contract: username first, RPC second, because a
  // refused username must never leave a rider stamped complete with no
  // username. `p_location: null` is a no-op against a rider's stored location
  // (075's `coalesce`), never a clear.
  const { data: completed, error: completionError } = await supabase.rpc('complete_onboarding', {
    p_location: null,
  })

  if (completionError) {
    // 23514 is the function's own guard — consent still missing. Reachable by
    // deep-linking past the terms prompt, which the route guard also covers,
    // so this is the second line rather than the first.
    if (completionError.code === '23514') return { error: 'Finish the earlier steps first.' }
    return { error: 'Could not save that. Try again.' }
  }
  if (!completed) return { error: 'Your profile could not be found. Sign in again.' }

  // Invalidated once, after both writes — not between them. Between the
  // username UPDATE and the RPC the rider has a username and no stamp, and
  // that window is benign: the resume target for that state is this same
  // screen, and resubmitting the same name updates their own row rather than
  // raising a unique violation against itself.
  invalidateOnboardingState()

  // **The stash is consumed HERE, at the end of the wizard** (`091`, PD-330;
  // both kinds since `093`, PD-360). A rider who arrived on an invite link with
  // no account is sent to `/onboarding/terms` and then here by the route guard,
  // because `023` refuses the claim's write until both stamps are set. Without
  // this line the detour ends at `/postcards` with a live token still in
  // `sessionStorage` and nothing reading it — the same dead end one screen
  // later, and quieter, because nothing errors.
  //
  // **This is not a claim and must never become one.** It returns the rider to
  // the preview, where they tap; see `claimRideInviteLink` and
  // `claimClubInviteLink` for why an automatic claim on session establishment
  // joins the wrong rider to a private ride or club.
  //
  // `takeAnyStashedInviteToken` clears as it reads, whichever kind is stashed,
  // and the destination re-stashes from its own query string — so the token is
  // never left behind for whoever signs in next on this device.
  const invite = takeAnyStashedInviteToken()

  return {
    error: null,
    redirectTo: invite
      ? invite.kind === 'ride'
        ? routes.joinRide(invite.token)
        : routes.joinClub(invite.token)
      : '/postcards',
  }
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
