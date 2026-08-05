'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/actions/state'

/**
 * Nothing but async functions may be exported from a `'use server'` module — a
 * plain const fails at *module evaluation* the moment a client component
 * imports it, taking the whole route down rather than the one value. That is
 * not hypothetical: it is how `/postcards/new` shipped dead. Shared constants
 * belong in `lib/actions/state.ts`.
 */

/**
 * Advances this rider's read watermark for one club to now (015).
 *
 * Called when the club is *opened*, which is the only moment that means "you
 * have seen what was new here". The alternative — advancing it when the list
 * renders — would clear every badge on the screen the rider was using to decide
 * which club to open.
 *
 * `upsert` rather than insert-or-update, on the `(user_id, club_id)` unique
 * index. The index is `nulls not distinct`, which is what makes the app-wide
 * row (`club_id is null`) collide with itself correctly when the postcard
 * filter tiles start writing one; without it every visit would insert another
 * row and this would never find a conflict to update.
 *
 * A failure is deliberately silent. The watermark is an optimisation of
 * attention, not a fact the rider asked to record — a club that opens fine but
 * keeps its badge is a far better outcome than an error banner over a page that
 * otherwise worked.
 */
export async function markClubSeen(clubId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('feed_reads')
    .upsert(
      { user_id: user.id, club_id: clubId, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,club_id' }
    )

  revalidatePath('/clubs')
}

/**
 * Joins a club — the `Join club` link on every `Clubs - Explore` row.
 *
 * This is the migration of the last v1 write in the app. `JoinClubButton` was
 * the final component calling `supabase.from()` in the browser and then
 * `router.refresh()`; per CLAUDE.md that pattern migrates on contact, and the
 * clubs epic is the contact.
 *
 * There is no authorization check here and that is correct rather than an
 * omission: 001's `club_members` INSERT policy is `auth.uid() = user_id`, and
 * the clubs SELECT policy is what decides whether a private club's id could
 * have been discovered at all. Re-deciding either in application code is how
 * the `is_public` subtraction bug got shipped twice.
 *
 * `role` is left to its default. Promotion to admin is a screen nobody has
 * designed, and passing 'member' explicitly would state a rule the database
 * already owns.
 */
export async function joinClub(clubId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to join a club.' }

  const { error } = await supabase
    .from('club_members')
    // Pressing Join twice is a no-op rather than an error. `ignoreDuplicates`
    // for the same reason likes and hides use it: there is no UPDATE grant on
    // club_members, so the default on-conflict-update would fail 42501.
    .upsert({ club_id: clubId, user_id: user.id }, { onConflict: 'club_id,user_id', ignoreDuplicates: true })

  if (error) return { error: 'That club could not be joined.' }

  revalidatePath('/clubs')
  revalidatePath('/clubs/explore')
  revalidatePath(`/clubs/${clubId}`)
  return { error: null }
}

/**
 * Leaves a club.
 *
 * The row goes, and 015's FK cascade takes the watermark with it — so rejoining
 * later reads as "everything since you rejoined" rather than resurfacing a
 * year of history. That is a consequence of `on delete cascade` rather than a
 * decision made here, and it is the behaviour you would have chosen.
 *
 * No guard against the owner leaving their own club, which would orphan it.
 * `clubs.owner_id` has no such guard either — the design draws no ownership
 * transfer, and inventing one in an action while the database permits it would
 * put the rule in the weakest of the two places. Registered rather than fixed.
 */
export async function leaveClub(clubId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase
    .from('club_members')
    .delete()
    .eq('club_id', clubId)
    .eq('user_id', user.id)

  if (error) return { error: 'You could not be removed from that club.' }

  revalidatePath('/clubs')
  revalidatePath('/clubs/explore')
  revalidatePath(`/clubs/${clubId}`)
  return { error: null }
}
