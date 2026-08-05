'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { clubSchema } from '@/lib/validation/clubs'
import type { ActionState } from '@/lib/actions/state'

/**
 * Nothing but async functions may be exported from a `'use server'` module — a
 * plain const fails at *module evaluation* the moment a client component
 * imports it, taking the whole route down rather than the one value. That is
 * not hypothetical: it is how `/postcards/new` shipped dead. Shared constants
 * belong in `lib/actions/state.ts`.
 */

/**
 * Creates a club and makes its creator the owner.
 *
 * Replaces the v1 page, which inserted from the browser: it decided the owner
 * client-side, wrote `role: 'owner'` itself, and enforced no length rule at all,
 * because `001` declares `name` and `description` as bare `text`. Parsing here
 * is the only thing between a form and a megabyte of club name.
 *
 * **Two inserts and no transaction, which matters.** PostgREST has no
 * multi-statement transaction, so the membership row is a second round trip that
 * can fail on its own — leaving a club whose owner is not a member of it, which
 * is invisible on both Clubs sub-pages because `getYourClubs` reads membership.
 * The old page had exactly this hole and did not check the second result. This
 * one does, and rolls the club back by hand so a partial create cannot survive.
 * The real fix is a `security definer` function doing both in one statement, and
 * it is a migration; recorded rather than pretended away.
 *
 * Images are already in Storage by the time this runs — the client uploads
 * first, so a failure here leaves an orphaned object rather than a club pointing
 * at nothing, which is the same direction `/postcards/new` fails in and the
 * survivable one. `npm run storage:sweep` is what collects them.
 */
export async function createClub(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = clubSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    is_public: formData.get('is_public') === 'on',
    avatar_path: (formData.get('avatar_path') as string) || null,
    cover_image_path: (formData.get('cover_image_path') as string) || null,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to create a club.' }

  const { data: club, error } = await supabase
    .from('clubs')
    .insert({ ...parsed.data, owner_id: user.id })
    .select('id')
    .single()

  if (error || !club) return { error: 'That club could not be created.' }

  // `role` is stated here and nowhere else in this file: 001 defaults it to
  // 'member', and the creator is the one membership that is not.
  const { error: membershipError } = await supabase
    .from('club_members')
    .insert({ club_id: club.id, user_id: user.id, role: 'owner' })

  if (membershipError) {
    await supabase.from('clubs').delete().eq('id', club.id)
    return { error: 'That club could not be created.' }
  }

  revalidatePath('/clubs')
  revalidatePath('/clubs/explore')
  redirect(`/clubs/${club.id}`)
}

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
 * Advances the **app-wide** watermark — `feed_reads.club_id is null`, the row
 * 015 created the shape for and left without a writer.
 *
 * Fired when the postcard deck is exhausted, which is the whole reason a
 * watermark is honest here. A watermark can only say "everything older than T
 * is read", and the deck is newest-first — so a rider three cards into twelve
 * has read a *prefix* no timestamp represents. Marking only at the end means the
 * badge is never wrong in the direction that hides something unseen.
 *
 * `club_id: null` relies on 015's `unique nulls not distinct`. Under a plain
 * UNIQUE this upsert would find no conflict and insert a second app-wide row
 * every time the rider finished the deck.
 */
export async function markFeedSeen(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('feed_reads')
    .upsert(
      { user_id: user.id, club_id: null, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,club_id' }
    )

  revalidatePath('/postcards')
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
