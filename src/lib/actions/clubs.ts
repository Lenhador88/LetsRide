import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { clubSchema } from '@/lib/validation/clubs'
import type { ActionState } from '@/lib/actions/state'

/**
 * Nothing but async functions may be exported from a `'use server'` module — a
 * plain const fails at *module evaluation* the moment a client component
 * imports it, taking the whole route down rather than the one value. That is
 * not hypothetical: it is how `/postcards/new` shipped dead. Shared constants
 * belong in `lib/actions/state.ts`.
 *
 * **This module no longer carries the directive**, so that rule no longer binds
 * it — writes run in the browser now. The split stays anyway, and the rule is
 * kept here rather than deleted because it is enforced for any module that gets
 * the directive back (`src/__tests__/use-server-exports.test.ts`).
 */

/**
 * What joining or leaving a club makes stale.
 *
 * `clubs.all()` is the prefix over both lists, the detail and its member roster
 * — but **it is not the whole blast radius, and the naive translation missed
 * that.** The third path these two actions used to revalidate was
 * `` `/clubs/${clubId}` ``, and that is a *route*: re-rendering it refetched the
 * club, its timeline feed AND its ride strip, because all three are read by the
 * page at that path. Only the first of those three lives under the `clubs`
 * prefix. The other two are `postcards.feed('club:<id>')` and
 * `rides.list('club:<id>')`, which sit under `postcards` and `rides`.
 *
 * The symptom, found by review rather than by a test: a rider who looked at a
 * public club's timeline before joining, then joined, then went back inside the
 * 30s stale window, saw the pre-join content — an empty timeline for a club they
 * were now in.
 *
 * This is the exact failure `keys.ts` predicts for a path-shaped claim that
 * covers more than its own domain, and it is why `filterSegment` exists: the
 * strings below have to match the ones five screens build, and now both come
 * from the same place.
 */
function invalidateClubMembership(clubId: string) {
  invalidate(queryKeys.clubs.all())
  invalidate(queryKeys.postcards.feed(filterSegment.club(clubId)))
  invalidate(queryKeys.rides.list(filterSegment.club(clubId)))
}

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
 * can fail on its own — leaving a club whose owner is not a member of it. That
 * club is missing from *Your clubs*, which reads membership; it is **not**
 * invisible, as this comment used to claim. `008`'s SELECT policy has an
 * `owner_id = auth.uid()` arm, and a public one shows on Explore to every rider
 * and is joinable. The old page had exactly this hole and did not check the
 * second result. This
 * one does, and rolls the club back by hand so a partial create cannot survive.
 * The real fix is a `security definer` function doing both in one statement, and
 * it is a migration; recorded rather than pretended away.
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

  const supabase = await resolveSupabase()
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
    // The rollback can fail too, and discarding its error is how "could not be
    // created" becomes a lie: the club survives, invisible on Your clubs (which
    // reads membership) and visible on Explore to everyone. The rider retries
    // and owns two. Surfacing it is not a fix — the fix is one statement in a
    // security definer function — but it stops the message contradicting the
    // state.
    const { error: rollbackError } = await supabase.from('clubs').delete().eq('id', club.id)
    if (rollbackError) {
      return {
        error: 'That club was only partly created. Check your clubs before trying again.',
      }
    }
    return { error: 'That club could not be created.' }
  }

  // Both club lists at once: `clubs.all()` is the prefix over `yours`,
  // `explore` and `mine` (the picker on the create-ride and create-postcard
  // forms), which the two `revalidatePath` calls this replaces covered between
  // them — and the picker, which neither did, because no route drew it.
  invalidate(queryKeys.clubs.all())
  return { error: null, redirectTo: `/clubs/${club.id}` }
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
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('feed_reads')
    .upsert(
      { user_id: user.id, club_id: clubId, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,club_id' }
    )

  // `yours` only, matching `revalidatePath('/clubs')` exactly rather than
  // widening to the `clubs` prefix. Explore is the one club list with no
  // counter to move: `getExploreClubs` deliberately calls `toClubListItem`
  // without an unread argument, because the design puts `Join club` in the slot
  // the badge occupies and `015` refuses a watermark for a club you have not
  // joined. Invalidating it here would refetch a list nothing changed on.
  invalidate(queryKeys.clubs.yours())
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
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('feed_reads')
    .upsert(
      { user_id: user.id, club_id: null, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,club_id' }
    )

  // The filter bar only, not the feed. `revalidatePath('/postcards')` re-ran
  // the whole page because a path is the smallest thing it can name; the
  // watermark moves the "All new" tile's count and nothing else. Refetching the
  // deck here would be worse than wasteful — this fires the moment the deck is
  // exhausted, so it would replace the card list underneath the "start over"
  // state the rider is looking at.
  invalidate(queryKeys.postcards.filters())
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
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to join a club.' }

  const { error } = await supabase
    .from('club_members')
    // Pressing Join twice is a no-op rather than an error. `ignoreDuplicates`
    // for the same reason likes and hides use it: there is no UPDATE grant on
    // club_members, so the default on-conflict-update would fail 42501.
    .upsert({ club_id: clubId, user_id: user.id }, { onConflict: 'club_id,user_id', ignoreDuplicates: true })

  if (error) return { error: 'That club could not be joined.' }

  invalidateClubMembership(clubId)
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
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase
    .from('club_members')
    .delete()
    .eq('club_id', clubId)
    .eq('user_id', user.id)

  if (error) return { error: 'You could not be removed from that club.' }

  invalidateClubMembership(clubId)
  return { error: null }
}
