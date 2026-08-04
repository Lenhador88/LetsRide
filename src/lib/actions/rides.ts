'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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
