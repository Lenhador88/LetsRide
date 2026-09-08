import { capture } from '@/lib/analytics/client'
import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidateOnboardingState } from '@/lib/auth/guard-cache'
import { isUsernameTaken } from '@/lib/data/profile'
import {
  USERNAME_TAKEN_MESSAGE,
  checkUsername,
  countryCodeSchema,
  locationSchema,
} from '@/lib/validation/profile'
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
      // **PD-353's question 3, and the only one of the ten that SQL cannot
      // reach.** A rider who tries three usernames, finds all three taken and
      // closes the tab has written NOTHING: `profiles` shows them at
      // "consented, no username", identical to a rider who never tried. The
      // stage is visible in SQL and the cause is not, which is exactly why
      // instrumenting the wizard makes `analytics.md`'s proposed attempt ledger
      // unnecessary.
      //
      // `reason` and never the name that was rejected. It is the rider's chosen
      // identity, `taken` already tells the FIELD what it needs, and 'taken'
      // answers the funnel question on its own — the same rule that keeps a
      // place-search term out of `place_search_attempts`.
      capture({
        name: 'onboarding_step',
        properties: { step: 'username', status: 'rejected', reason: 'taken' },
      })
      return { error: USERNAME_TAKEN_MESSAGE, taken: parsed.username }
    }
    // 23514 is a CHECK constraint — charset, length, or the reserved denylist.
    // Only reachable if something bypassed the schema above.
    if (error.code === '23514') {
      capture({
        name: 'onboarding_step',
        properties: { step: 'username', status: 'rejected', reason: 'invalid' },
      })
      return { error: 'That username is not available.' }
    }
    capture({
      name: 'onboarding_step',
      properties: { step: 'username', status: 'rejected', reason: 'failed' },
    })
    return { error: 'Could not save that username. Try again.' }
  }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  // **The completion RPC is NOT called here any more — PD-428 gave the wizard a
  // second step and completion belongs to the last one.** `setHomeTown`
  // makes that call now. Moving it was mandatory rather than tidy: `114`
  // refuses to stamp completion while `home_country` is NULL, so a
  // `complete_onboarding` here would be refused for every new rider and the
  // username step would fail with a message about a country they have not been
  // asked for yet.
  //
  // **The invalidation stays, and it is now load-bearing for a different
  // reason.** It used to be "we just wrote the completion stamp"; it is now
  // "we just wrote the username", and `has_username` is exactly what the
  // guard's resume branch reads to decide between this step and the town
  // one. Without it the cached state still says `has_username: false` and the
  // guard sends the rider straight back here, which is the finish-a-step-and-
  // bounce-into-it failure `writers-invalidate.test.ts` exists to refuse.
  invalidateOnboardingState()

  // "Username accepted", and since PD-428 that is no longer the same event as
  // "onboarding finished" — the town step owns the second one.
  // `profiles.onboarding_completed_at` still answers "did they finish" in SQL,
  // and PD-353 is explicit that what is worth instrumenting is the step that
  // turns a rider AWAY, not the one they got through.
  capture({
    name: 'onboarding_step',
    properties: { step: 'username', status: 'completed' },
  })

  // **The invite stash is NOT consumed here — it moved to the terminal step
  // with the completion stamp** (PD-428; `setHomeTown` since PD-445). It has to travel with the terminal
  // step and not merely with "the step that used to be terminal": `023`
  // refuses the claim's write until BOTH stamps are set, so consuming the token
  // here would clear it one screen before the rider is allowed to use it, and
  // `takeAnyStashedInviteToken` clears as it reads. The rider would land on
  // `/postcards` with the invite silently gone — the same dead end the stash
  // exists to prevent, moved one screen earlier and made quieter.
  return { error: null, redirectTo: '/onboarding/town' }
}

/**
 * The wizard's terminal step since PD-428: the rider's home country, and the
 * write that commits the completion stamp.
 *
 * ## Why a country is required at all, and a town is not
 *
 * PD-419 shipped device-or-town and both are refusable, so a rider could finish
 * onboarding with no position whatsoever. That is survivable in one market —
 * `nearby` barely discriminates when everything is in the Netherlands — and it
 * is the app failing at its job in ten, where a rider with no position gets an
 * undifferentiated global list. A country is always answerable, impossible to
 * get subtly wrong, and exactly the discriminator that matters at ten markets.
 *
 * **Neither this nor the town is a permission, which is what makes a mandatory
 * one legitimate.** A form field answered is consent; an OS prompt with no
 * escape is not. This must never become an argument for forcing the device
 * prompt — PD-419's decline rule stands, including no IP lookup at any point.
 *
 * ## The order of the two writes is contract
 *
 * The column UPDATE first, the RPC second, mirroring `setUsername`'s own
 * ordering and for the same reason: `114` refuses to stamp completion while
 * `home_country` is NULL, so the reverse order is refused every time. The
 * window between them — country stored, not yet stamped — is benign, because
 * the guard's resume target for that state is this same screen and re-submitting
 * writes the same value to the rider's own row.
 *
 * **The country does NOT arrive as an argument to `complete_onboarding`**, and
 * the issue that asked for this proposed that it should. It cannot: `create or
 * replace` cannot add a parameter, so `complete_onboarding(p_location, p_country)`
 * is an *overload*, and the one-argument call every existing signup makes then
 * matches both candidates and answers `PGRST203`. The requirement still lives
 * inside the function, which reads the stored column — only the value's path is
 * different.
 */
export async function setHomeTown(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  // `String(... ?? '')` rather than handing the raw entry to Zod, exactly as
  // `setUsername` does: a missing field would otherwise surface Zod's own
  // "expected string, received null" at a rider.
  const parsed = countryCodeSchema.safeParse(String(formData.get('country') ?? ''))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // The town, which since PD-445 arrives from the same pick as the country.
  // **Absent is legal and is the escape**: a rider whose lookup was unavailable
  // answers the country alone, and `complete_onboarding` does not require a
  // town. A PRESENT town still has to parse — `018`'s CHECK bounds the column
  // and `locationSchema` is the client-side half of that bound.
  const rawTown = formData.get('town')
  const town = rawTown === null ? null : locationSchema.safeParse(String(rawTown))
  if (town && !town.success) return { error: town.error.issues[0].message }
  const townValue = town?.success ? town.data : null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: null, redirectTo: '/auth/login' }

  // **ONE statement for both columns, and `home_country` is written FIRST.**
  // Not style: `writers-invalidate.test.ts`'s per-function detector matches
  // `.update({ home_country:` with the key at the head of the literal, and it
  // is what proves this function still owes `invalidateOnboardingState()`.
  // Putting `location` first makes the detector stop matching — the test then
  // fails loudly on its own both-ways assertion rather than going quiet, which
  // is the point, but the ordering is the thing to keep.
  //
  // **The town is spread in rather than always written**, so a country-only
  // submit does not send `location: null`. It would be writing NULL over
  // nothing today, but it makes this function a clearer of a column it has no
  // business clearing the moment anything else can reach this screen.
  //
  // `.select().maybeSingle()` so a zero-row update is distinguishable from a
  // successful one. PostgREST reports no error when an update matches nothing,
  // and the guard reads a missing profile row as "not onboarded" — so without
  // this the rider is bounced back to step 1 for ever while every screen
  // reports success. Same trap `setUsername` documents.
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ home_country: parsed.data, ...(townValue === null ? {} : { location: townValue }) })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    // 23514 is `113`'s pair of CHECK constraints — the shape one or the
    // membership one. Only reachable if something bypassed the schema above,
    // since the picker offers `COUNTRY_CODES` and nothing else.
    if (error.code === '23514') {
      capture({
        name: 'onboarding_step',
        properties: { step: 'town', status: 'rejected', reason: 'invalid' },
      })
      return { error: 'That is not a country we know.' }
    }
    capture({
      name: 'onboarding_step',
      properties: { step: 'town', status: 'rejected', reason: 'failed' },
    })
    return { error: 'Could not save that. Try again.' }
  }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  // **`p_location` stays `null`, and that is load-bearing rather than left
  // over.** The town is written by the UPDATE above; `075`'s body is
  // `coalesce(nullif(pg_catalog.btrim(p_location), ''), p.location)`, so `null`
  // here is a no-op against whatever that statement just stored, never a clear.
  //
  // A real argument would be worse than redundant: `114`'s guard is
  // `if not v_was_complete`, so a rider who onboarded before `113` and
  // deep-links back here is never refused — and passing their town through
  // `p_location` on that re-run would overwrite the one they already have.
  const { data: completed, error: completionError } = await supabase.rpc('complete_onboarding', {
    p_location: null,
  })

  if (completionError) {
    // 23514 here is the function's own guard — consent or username still
    // missing, or (once `114` applies) a country that did not land. All three
    // are reachable only by deep-linking past a step, which the route guard
    // also covers, so this is the second line rather than the first.
    if (completionError.code === '23514') {
      capture({
        name: 'onboarding_step',
        properties: { step: 'town', status: 'rejected', reason: 'incomplete' },
      })
      return { error: 'Finish the earlier steps first.' }
    }
    capture({
      name: 'onboarding_step',
      properties: { step: 'town', status: 'rejected', reason: 'failed' },
    })
    return { error: 'Could not save that. Try again.' }
  }
  if (!completed) return { error: 'Your profile could not be found. Sign in again.' }

  // Once, after both writes rather than between them — the stamp the guard
  // cached is what sent the rider here, and it is now stale in two fields.
  invalidateOnboardingState()

  // `no_country` on a COMPLETION rather than a rejection: the rider finished
  // through the escape the step opens when the lookup is unavailable, so they
  // carry a country and no town. It is the only way to ask how often onboarding
  // is completing without a town — which matters because `search-places`'s
  // ceiling is application-wide, so the cause is correlated across riders.
  capture({
    name: 'onboarding_step',
    properties: {
      step: 'town',
      status: 'completed',
      ...(townValue === null ? { reason: 'no_country' as const } : {}),
    },
  })

  // **The stash is consumed HERE, at the end of the wizard** (`091`, PD-330;
  // both kinds since `093`, PD-360; moved from `setUsername` by PD-428 when
  // that stopped being the last step). A rider who arrived on an invite link
  // with no account is walked through consent, username and this screen by the
  // route guard, because `023` refuses the claim's write until both stamps are
  // set. Without this line the detour ends at `/postcards` with a live token
  // still in `sessionStorage` and nothing reading it.
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
  if (error || !accepted) {
    capture({
      name: 'onboarding_step',
      properties: { step: 'terms', status: 'rejected', reason: 'failed' },
    })
    return { error: 'Could not record that. Try again.' }
  }

  capture({ name: 'onboarding_step', properties: { step: 'terms', status: 'completed' } })

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
