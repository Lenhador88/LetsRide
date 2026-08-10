import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { rideSchema } from '@/lib/validation/rides'
import { wallClockToUtc } from '@/lib/utils'
import type { ActionState } from '@/lib/actions/state'
import type { RideAttendance } from '@/types'

/**
 * The shared `emptyActionState` const lives in `lib/actions/state.ts` because
 * a `'use server'` module may export only async functions — see the note there,
 * and `src/__tests__/use-server-exports.test.ts`, which asserts the rule after
 * `postcards.ts` broke `/postcards/new` by violating it. This module no longer
 * carries the directive, so the rule no longer binds it; the split stays
 * because the constant is genuinely shared.
 */

/**
 * `rides.all()` is the prefix over the list, its filter tiles, the detail and
 * the crew — the three paths this replaces plus `filters`, which none of them
 * named. An RSVP moves the attendee collage the list draws, so the tiles were
 * always in the blast radius; `revalidatePath('/rides')` happened to cover them
 * because they render on that route.
 */
function invalidateRide() {
  invalidate(queryKeys.rides.all())
}

/**
 * Creates a ride and puts its organizer on the crew.
 *
 * Replaces the v1 page, which was the last `'use client'` screen in the app
 * writing through `supabase.from()`. That version set `organizer_id` from a
 * client-read user, enforced no length on four bare `text` columns, and passed
 * `new Date(value).toISOString()` — which resolves a zone-less
 * `datetime-local` string in the *browser's* zone, so the same input meant
 * different instants for different riders.
 *
 * **Two inserts and no transaction**, the same shape and the same caveat as
 * `createClub`: PostgREST has no multi-statement transaction, so the crew row is
 * a second round trip. A ride whose organizer is not on its own crew renders an
 * RSVP prompt to the person who created it, so the failure is rolled back by
 * hand rather than left. The real fix is a `security definer` function, and it
 * is a migration.
 *
 * **The rollback below stopped being a rollback when this module left the
 * server, and that is a real change rather than a restatement.** As a Server
 * Action, both inserts and the compensating delete ran inside one server request
 * that completed whether or not the tab survived. They run in the browser now,
 * so all three depend on it staying alive and cooperating — closing the tab
 * between the two inserts leaves a club with an owner and no membership row.
 * That state went from *reachable only on a Supabase error* to *reachable on
 * demand*.
 *
 * It is an integrity problem and not a confidentiality one: `019` means the
 * abandoner cannot forge a role on the way through, and `008`'s SELECT policy
 * has an `owner_id = auth.uid()` arm so the creator can still *see* the club —
 * it is `getYourClubs` reading membership that hides it, which makes this a UI
 * orphan rather than a database one. A public one shows on Explore to everyone
 * and is joinable.
 *
 * The fix is the same `security definer` function this comment has named since
 * it was written, doing both inserts in one statement. Nothing asserts "a club
 * has an owner-membership row" as a CHECK or trigger, and that is the actual
 * gap. Logged in docs/HANDOFF.md §Known issues.
 *
 * `club_id` is offered here for the first time. The column has existed since
 * `001` and no screen has ever set it, which meant a club's Rides sub-page
 * could only ever be empty — a hole the club detail made visible.
 */
export async function createRide(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const rawMax = (formData.get('max_riders') as string)?.trim()
  const rawClub = (formData.get('club_id') as string)?.trim()

  const parsed = rideSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    meeting_point: formData.get('meeting_point'),
    route_description: formData.get('route_description'),
    departure_at: formData.get('departure_at'),
    max_riders: rawMax ? Number(rawMax) : null,
    is_public: formData.get('is_public') === 'on',
    club_id: rawClub || null,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to create a ride.' }

  const { departure_at, ...rest } = parsed.data

  const { data: ride, error } = await supabase
    .from('rides')
    .insert({
      ...rest,
      departure_at: wallClockToUtc(departure_at),
      organizer_id: user.id,
    })
    .select('id')
    .single()

  // 022 refuses a public ride in a private club. Reachable from the default
  // path — the audience checkbox ships ticked and the club picker cannot tell a
  // private club from a public one — so the generic message below would leave
  // the rider with no route to the fix.
  //
  // Matched on the message rather than on `23514` alone, because 018's text
  // bounds raise the same SQLSTATE and a title-too-long must not be reported as
  // an audience problem. The string is the one `enforce_ride_club_audience`
  // raises in 022; a named CHECK would read "violates check constraint ..."
  // instead, which is how the two stay distinguishable.
  if (error?.code === '23514' && error.message.includes('private club cannot be public')) {
    return { error: 'A ride in a private club cannot be public. Untick “Make this ride public”, or pick a public club.' }
  }
  if (error || !ride) return { error: 'That ride could not be created.' }

  const { error: crewError } = await supabase
    .from('ride_members')
    .insert({ ride_id: ride.id, user_id: user.id, status: 'going' })

  if (crewError) {
    // Same as createClub: an unchecked rollback lets the failure message
    // contradict the state it leaves behind.
    const { error: rollbackError } = await supabase.from('rides').delete().eq('id', ride.id)
    if (rollbackError) {
      return {
        error: 'That ride was only partly created. Check your rides before trying again.',
      }
    }
    return { error: 'That ride could not be created.' }
  }

  invalidate(queryKeys.rides.all())
  // A ride created into a club appears on that club's Rides sub-page, which
  // `revalidatePath('/rides')` never reached — `/rides/new` only began offering
  // `club_id` on 2026-08-05 and this claim was not extended with it.
  if (rest.club_id) invalidate(queryKeys.clubs.detail(rest.club_id))
  return { error: null, redirectTo: `/rides/${ride.id}` }
}

/**
 * Sets — or clears — this rider's RSVP.
 *
 * `null` is `No`, and it **deletes the row** rather than storing a third
 * status. `ride_members.status` is `check (status in ('going','maybe'))`, so
 * "declined" has no representation; the Crew design draws only `Going` and
 * `May be going`, which is the same shape from the other side. The cost is that
 * a decline and a non-answer are indistinguishable, recorded on `RideCrew`.
 *
 * `upsert` rather than insert-or-update, because the row is keyed
 * `(ride_id, user_id)` and a rider double-tapping `Yes!` would otherwise race
 * itself into a 23505.
 *
 * Nothing here checks whether the ride is visible or joinable: 008's INSERT
 * policy delegates both to the rides SELECT policy via EXISTS, so restating
 * them would be a second copy free to drift.
 *
 * **`max_riders` is not enforced, here or anywhere.** The column has existed
 * since 001 and nothing has ever checked it — not this action, not a policy,
 * not a trigger — so a ride can be over-subscribed. It is out of scope here
 * because the ride plan design does not draw capacity at all, and because the
 * correct place for it is a constraint the database owns rather than a
 * check-then-insert in application code, which races. Logged in
 * docs/FIGMA-FIDELITY-TODO.md §Ride detail rather than silently inherited.
 */
export async function setRideAttendance(
  rideId: string,
  attendance: RideAttendance
): Promise<ActionState> {
  if (!rideId) return { error: 'That ride could not be found.' }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to RSVP.' }

  const { error } =
    attendance === null
      ? await supabase
          .from('ride_members')
          .delete()
          .eq('ride_id', rideId)
          .eq('user_id', user.id)
      : await supabase
          .from('ride_members')
          .upsert(
            { ride_id: rideId, user_id: user.id, status: attendance },
            { onConflict: 'ride_id,user_id' }
          )

  // A refusal is usually RLS deciding the ride is not visible, which from the
  // rider's side looks like the ride being gone rather than a permission
  // problem — so the message says that rather than accusing them.
  if (error) {
    return { error: 'Could not update your RSVP. The ride may no longer be available.' }
  }

  invalidateRide()
  return { error: null, sent: true }
}

/**
 * Saves an organizer's edit to their own ride — PD-101, `ride-lifecycle`.
 *
 * Bound to a specific `rideId` at the call site (`useActionState((prev, fd)
 * => updateRide(ride.id, prev, fd), …)`) rather than reading it out of
 * `formData`: the form has no field for it, the same way `deletePostcard`
 * takes its id as a plain argument rather than a hidden input.
 *
 * **The `.update()` payload is an explicit field list, never a spread of
 * `parsed.data`.** `authenticated` holds table-level UPDATE on every column
 * of `rides`, including `id`, `created_at` and `organizer_id` — the policy's
 * `WITH CHECK` stops `organizer_id` moving, but nothing stops `created_at`
 * being rewritten. This is advisory, not enforced — see the
 * `database-enforced-integrity` delta — and the real fix is narrowing the
 * grant, logged on `PD-163` rather than built here.
 */
export async function updateRide(
  rideId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const rawMax = (formData.get('max_riders') as string)?.trim()
  const rawClub = (formData.get('club_id') as string)?.trim()

  const parsed = rideSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    meeting_point: formData.get('meeting_point'),
    route_description: formData.get('route_description'),
    departure_at: formData.get('departure_at'),
    max_riders: rawMax ? Number(rawMax) : null,
    is_public: formData.get('is_public') === 'on',
    club_id: rawClub || null,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  // The zombie shape `029` names: neither public nor in a club is a ride only
  // its organizer could ever see again, with `ride_members` rows still
  // attached to it. `EditRideForm` disables Save on this combination already;
  // this is the guard for whatever reaches the action anyway.
  if (!parsed.data.club_id && !parsed.data.is_public) {
    return {
      error:
        'A ride needs to be public or belong to a club, or nobody but you could ever see it again. Make it public, or pick a club.',
    }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit a ride.' }

  const { departure_at, title, description, route_description, meeting_point, max_riders, is_public, club_id } =
    parsed.data

  const { data: ride, error } = await supabase
    .from('rides')
    .update({
      title,
      description,
      route_description,
      meeting_point,
      departure_at: wallClockToUtc(departure_at),
      max_riders,
      is_public,
      club_id,
    })
    .eq('id', rideId)
    .select('id')
    .maybeSingle()

  // Same match `createRide` makes, and for the same reason: 022 fires on
  // UPDATE as much as on INSERT, and 018's length CHECKs raise the same
  // SQLSTATE, so the message is matched too rather than the code alone — a
  // title-too-long must not be reported as an audience problem.
  if (error?.code === '23514' && error.message.includes('private club cannot be public')) {
    return { error: 'A ride in a private club cannot be public. Untick “Make this ride public”, or pick a public club.' }
  }

  // The `WITH CHECK`, not the `USING` clause. `USING` passes for this rider —
  // they are still `organizer_id` — but the post-image fails
  // `private.is_club_member(club_id)`, which Postgres reports as an RLS
  // violation rather than a silent zero-row update. This is
  // `ride-lifecycle`'s "ex-member organizer" case: reachable the moment
  // `leaveClub` runs on a club whose ride this rider still organises, on a
  // save that may not have touched `club_id` at all.
  if (error?.code === '42501') {
    return {
      error:
        'You’ve left this ride’s club, so changes can’t be saved while it stays linked. Delete the ride, or make it public and remove it from the club.',
    }
  }

  if (error) return { error: 'That ride could not be saved.' }
  // Not the ex-member case above (that raises) and not a length violation
  // (that raises too) — zero rows with no error is a non-organizer's write,
  // which `USING` filters out silently rather than refusing loudly.
  if (!ride) return { error: 'That ride is not yours to edit.' }

  // `rides.all()`, not `rides.detail(rideId)` alone: `club_id` and
  // `is_public` are both editable, and an edit can move the ride between
  // filter segments — narrower invalidation would leave it visible in a list
  // it no longer belongs to.
  invalidate(queryKeys.rides.all())
  return { error: null, redirectTo: `/rides/${rideId}` }
}

/**
 * Cancels a ride — PD-101, `ride-lifecycle`. Needs no `security definer`
 * function, unlike a club delete: `ride_members`, `ride_messages` and
 * `notifications.ride_id` all cascade, and `postcards.ride_id` is `SET NULL`
 * on a column that is a tag rather than an audience, so nulling it changes a
 * tagged postcard's visibility by exactly nothing (`design.md` §D2).
 *
 * No `.eq('organizer_id', …)`: the DELETE policy is already
 * `auth.uid() = organizer_id`, and restating it here would be a second copy
 * of a rule RLS owns. `.select()` is what makes a refusal detectable —
 * PostgREST reports no error when a delete matches nothing.
 */
export async function deleteRide(rideId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { data: deleted, error } = await supabase
    .from('rides')
    .delete()
    .eq('id', rideId)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not cancel that ride. Try again.' }
  if (!deleted) return { error: 'That ride is not yours to cancel.' }

  invalidate(queryKeys.rides.all())
  // postcards.ride_id is SET NULL by the cascade, so any postcard tagged to
  // this ride has changed even though this call never named one.
  invalidate(queryKeys.postcards.all())
  return { error: null }
}
