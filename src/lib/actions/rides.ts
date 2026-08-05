'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { rideSchema } from '@/lib/validation/rides'
import { wallClockToUtc } from '@/lib/utils'
import type { ActionState } from '@/lib/actions/state'
import type { RideAttendance } from '@/types'

/**
 * This module exports only async functions, which `'use server'` requires. The
 * shared `emptyActionState` const lives in `lib/actions/state.ts` for exactly
 * that reason — see the note there, and `src/__tests__/use-server-exports.test.ts`,
 * which asserts the rule after `postcards.ts` broke `/postcards/new` by
 * violating it.
 */

function revalidateRide(rideId: string) {
  revalidatePath('/rides')
  revalidatePath(`/rides/${rideId}`)
  revalidatePath(`/rides/${rideId}/crew`)
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

  const supabase = await createClient()
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

  revalidatePath('/rides')
  redirect(`/rides/${ride.id}`)
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

  const supabase = await createClient()
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

  revalidateRide(rideId)
  return { error: null, sent: true }
}
