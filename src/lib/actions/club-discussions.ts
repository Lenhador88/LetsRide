import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { clubDiscussionTitleSchema, clubMessageBodySchema } from '@/lib/validation/clubs'
import type { ActionState } from '@/lib/actions/state'

/**
 * Opens a thread in a club — one INSERT, a title and no first message (`081`,
 * PD-307).
 *
 * **Creation deliberately does not write a first message**, and the empty thread
 * that follows is a legitimate state rather than a hole: PostgREST offers no
 * transaction and the client owns the mutation path, so "thread plus first
 * message atomically" is either a `security definer` RPC — where the
 * participation gate could never fire, `current_user` being the owner inside a
 * definer body (`023` §2) — or a lie. See design.md §Thread creation.
 *
 * ## What is deliberately not checked here
 *
 * No membership check and no club-visibility check. `081`'s INSERT policy
 * delegates both to `private.is_club_member`, so a rider who never joined — or
 * who left — is refused by the database. Restating it would be a second copy of
 * a rule RLS owns, free to drift, and it would also be *weaker*: the client's
 * copy could be skipped by anyone posting with the publishable key, which ships
 * in the bundle.
 *
 * `author_id` comes from the session rather than the form, for the same reason
 * the policy names `auth.uid()`: a parameter is something a caller can get
 * wrong.
 */
export async function createClubDiscussion(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const clubId = (formData.get('club_id') as string | null) ?? ''
  if (!clubId) return { error: 'That club could not be found.' }

  const parsed = clubDiscussionTitleSchema.safeParse(formData.get('title') ?? '')
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to start a discussion.' }

  const { data: discussion, error } = await supabase
    .from('club_discussions')
    .insert({ club_id: clubId, author_id: user.id, title: parsed.data })
    // A `select` on an INSERT is safe where it is not on a DELETE: the row is
    // one this rider authored in a club they are a member of, so `081`'s SELECT
    // policy returns it. See `deleteClubDiscussion` for the case where the same
    // chaining is a defect.
    .select('id')
    .single()

  if (error || !discussion) {
    // `23514` is the participation gate (`023`) or the title CHECK (`081`). The
    // length is already refused above by a schema mirroring that constraint, so
    // in practice this is the gate: an un-onboarded or un-consented rider who
    // got past the route guard.
    if (error?.code === '23514') {
      return { error: 'Finish setting up your account before posting.' }
    }
    // Everything else is RLS deciding this rider is not in this club, which from
    // their side reads as the club being closed to them rather than as a
    // permission problem.
    return { error: 'That discussion could not be started. You may no longer be in this club.' }
  }

  invalidate(queryKeys.clubs.discussions(clubId))
  return { error: null, redirectTo: routes.clubDiscussion(discussion.id) }
}

/**
 * Deletes a thread the caller authored — `081`'s DELETE policy, `author_id =
 * auth.uid()`. The club owner's equivalent is `moderateClubDiscussion` below.
 *
 * **No `.select()` on the delete, and that is load-bearing rather than tidy.**
 * `RETURNING` re-attaches the SELECT policy to the statement (measured, Postgres
 * 17.6), which is the mechanism that makes a delete match zero rows and still
 * report success. It cannot bite an author on `club_discussions` — the SELECT
 * policy exempts them through its own `author_id = auth.uid()` arm — but the
 * chaining is the habit that makes it bite elsewhere, so it is not written here.
 *
 * `clubId` is a parameter rather than re-read from the row, because by the time
 * the invalidation runs the row is gone.
 */
export async function deleteClubDiscussion(
  discussionId: string,
  clubId: string
): Promise<ActionState> {
  if (!discussionId || !clubId) return { error: 'That discussion could not be found.' }

  const supabase = await resolveSupabase()

  const { error } = await supabase.from('club_discussions').delete().eq('id', discussionId)

  if (error) return { error: 'That discussion could not be deleted.' }

  invalidateDiscussion(discussionId, clubId)
  return { error: null, redirectTo: routes.clubDiscussions(clubId) }
}

/**
 * The club owner deleting somebody else's thread — `moderate_club_discussion`,
 * `security definer`, re-checking `clubs.owner_id = auth.uid()` in its own body.
 *
 * **An RPC rather than a second arm on the DELETE policy, and the difference is
 * a case `034` did not have.** RLS filters a DELETE by what the caller may
 * READ, so an owner who has blocked a thread's author cannot see that thread and
 * a policy-arm delete keyed on its id matches zero rows — silently, PostgREST
 * reporting success. A thread is a persistent titled object every *other* member
 * keeps reading, so the block is not the remedy here and the moderation right
 * must not depend on the owner being able to see the row.
 *
 * One refusal for "no such thread" and "not your club" alike (`043`'s shape), so
 * the message must not speculate about which it was.
 */
export async function moderateClubDiscussion(
  discussionId: string,
  clubId: string
): Promise<ActionState> {
  if (!discussionId || !clubId) return { error: 'That discussion could not be found.' }

  const supabase = await resolveSupabase()

  // No `.select()` chained onto an RPC that returns void: it would ask
  // PostgREST for a representation of nothing.
  const { error } = await supabase.rpc('moderate_club_discussion', { discussion: discussionId })

  if (error) return { error: 'That discussion could not be deleted.' }

  invalidateDiscussion(discussionId, clubId)
  return { error: null, redirectTo: routes.clubDiscussions(clubId) }
}

/**
 * Posts one message into a thread.
 *
 * ## Why it takes an id instead of generating one
 *
 * `081` gives `club_messages.id` a default *and* leaves it client-suppliable,
 * for `034`'s reason: the composer draws the message the instant it is sent, and
 * when the real row arrives — by refetch or over the Realtime channel — the two
 * have to be recognised as the same message, or the rider sees their own text
 * twice. Matching on content is wrong in the ordinary case rather than the
 * exotic one (send "ok" twice and the second echo cancels the first optimistic
 * row); matching on `created_at` is worse, that being the server's clock.
 */
export async function sendClubMessage(
  discussionId: string,
  body: string,
  messageId: string
): Promise<ActionState> {
  if (!discussionId) return { error: 'That discussion could not be found.' }

  const parsed = clubMessageBodySchema.safeParse(body)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to send a message.' }

  const { error } = await supabase
    .from('club_messages')
    .insert({ id: messageId, discussion_id: discussionId, author_id: user.id, body: parsed.data })

  if (error) {
    // The gate or the length CHECK — see `createClubDiscussion`.
    if (error.code === '23514') {
      return { error: 'Finish setting up your account before posting.' }
    }
    // `23505` is the primary key: this exact message id is already stored, which
    // is the retry path the suppliable id exists for — a caller keeping the id
    // across a retry after an ambiguous timeout. Treating it as success is right
    // for that caller and harmless here, where reaching it means a v4 collision;
    // what it must not do is report failure, because the message would be in the
    // thread and the rider would send it again. It discloses nothing: RLS
    // evaluates WITH CHECK before the index insert, so a non-member is refused
    // `42501` and never reaches a duplicate-key error.
    if (error.code === '23505') {
      invalidate(queryKeys.clubs.discussionMessages(discussionId))
      return { error: null, sent: true }
    }
    return { error: 'Could not send that message. You may no longer be in this club.' }
  }

  invalidate(queryKeys.clubs.discussionMessages(discussionId))
  return { error: null, sent: true }
}

/**
 * Erases a message the caller wrote — **the only path there is**.
 *
 * `club_messages` holds no DELETE grant and no DELETE policy, deliberately: RLS
 * applies the SELECT policy to a `DELETE` whose `WHERE` names a column, and
 * `supabase-js` issues exactly that form, so a rider blocked by the thread's
 * author would silently fail to erase their own words while every unblocked
 * member kept reading them. `delete_own_club_message` is `security definer` and
 * re-checks `author_id = auth.uid()` itself.
 *
 * **Authorship is the whole test — there is no club-membership conjunct**, so a
 * rider who has left the club can still retract what they wrote. That diverges
 * from `ride_messages` on purpose: a ride's chat disappears with the ride, while
 * a club thread is a permanent titled surface others keep reading.
 */
export async function deleteClubMessage(
  messageId: string,
  discussionId: string
): Promise<ActionState> {
  if (!messageId || !discussionId) return { error: 'That message could not be found.' }

  const supabase = await resolveSupabase()

  const { error } = await supabase.rpc('delete_own_club_message', { message: messageId })

  if (error) return { error: 'That message could not be deleted.' }

  invalidate(queryKeys.clubs.discussionMessages(discussionId))
  return { error: null }
}

/**
 * Advances this rider's read watermark for one thread to now (`081`, `061`'s
 * shape).
 *
 * **`last_read_at` is sent and then thrown away**, which looks redundant and is
 * not. `081` hangs a `BEFORE INSERT OR UPDATE` trigger that overwrites it with
 * server time, because the value is compared against `club_messages.created_at`
 * — server-owned, `created_at` being outside the INSERT column grant — and a
 * comparison spanning a phone's clock and the database's is wrong in a way
 * nothing logs.
 *
 * **Withholding the column grant instead would NOT work here**, and the obvious
 * reasoning ("PostgREST names every column, so the revoke refuses the write") is
 * the one `061` §3 measured and corrected: PostgREST builds the `do update set`
 * list from the **request body**, so a column the body omits needs no privilege
 * and nothing raises — and the upsert's UPDATE arm would then set nothing at
 * all. The column is sent so the SET list is explicit; the trigger is what makes
 * the value true.
 *
 * A failure is deliberately silent, and the direction is the safe one: an
 * unwritten watermark lights the mark again on the next visit, which
 * over-reports unread rather than hiding a message.
 *
 * The invalidation is `clubs.discussionsUnread(clubId)` and nothing else. It is
 * a longer prefix than the list's, so it deliberately does **not** reach
 * `clubs.discussions` — this fires on every message arriving while the thread is
 * open, and refetching the club's whole thread list each time would turn one
 * delivered message into two round trips.
 */
export async function markClubDiscussionSeen(
  discussionId: string,
  clubId: string
): Promise<void> {
  if (!discussionId || !clubId) return

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('club_discussion_reads')
    .upsert(
      {
        user_id: user.id,
        discussion_id: discussionId,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,discussion_id' }
    )

  invalidate(queryKeys.clubs.discussionsUnread(clubId))
}

/**
 * A thread that has ceased to exist moves two things and they are not one
 * prefix: the club's list, and the thread's own messages. `keys.ts` records why
 * the second is not reached by the first — the messages key hangs off the
 * discussion id, because the thread screen holds only that.
 */
function invalidateDiscussion(discussionId: string, clubId: string) {
  invalidate(queryKeys.clubs.discussions(clubId))
  invalidate(queryKeys.clubs.discussionMessages(discussionId))
}
