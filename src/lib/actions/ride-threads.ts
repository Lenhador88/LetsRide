import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { rideThreadTitleSchema, rideThreadMessageBodySchema } from '@/lib/validation/rides'
import type { ActionState } from '@/lib/actions/state'

/**
 * Writes for a ride's threads — `108`, PD-402, `lib/actions/club-threads.ts`
 * one domain over.
 *
 * **What is deliberately not checked in any function here**: no crew check and
 * no ride-visibility check. `108`'s INSERT policies delegate both to the same
 * conjunction its SELECT policies use — the `EXISTS` against `rides` and
 * `private.is_ride_crew` — so a rider who never joined, or who left, is refused
 * by the database. Restating it would be a second copy of a rule RLS owns, free
 * to drift, and it would also be *weaker*: the client's copy could be skipped by
 * anyone posting with the publishable key, which ships in the bundle.
 *
 * `author_id` comes from the session rather than the form, for the same reason
 * the policy names `auth.uid()`: a parameter is something a caller can get
 * wrong.
 */

/**
 * Opens a thread on a ride — one INSERT, a title and no first message.
 *
 * **Creation deliberately does not write a first message**, and the empty thread
 * that follows is a legitimate state rather than a hole: PostgREST offers no
 * transaction and the client owns the mutation path, so "thread plus first
 * message atomically" is either a `security definer` RPC — where the
 * participation gate could never fire, `current_user` being the owner inside a
 * definer body (`023` §2) — or a lie. `081`'s ruling, adopted whole.
 */
export async function createRideThread(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const rideId = (formData.get('ride_id') as string | null) ?? ''
  if (!rideId) return { error: 'That ride could not be found.' }

  const parsed = rideThreadTitleSchema.safeParse(formData.get('title') ?? '')
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to start a thread.' }

  const { data: thread, error } = await supabase
    .from('ride_threads')
    .insert({ ride_id: rideId, author_id: user.id, title: parsed.data })
    // A `select` on an INSERT is safe where it is not on a DELETE: the row is
    // one this rider authored on a ride they are crew of, so `108`'s SELECT
    // policy returns it.
    .select('id')
    .single()

  if (error || !thread) {
    // `23514` is the participation gate (`023`) or the title CHECK (`108`). The
    // length is already refused above by a schema mirroring that constraint, so
    // in practice this is the gate: an un-onboarded or un-consented rider who
    // got past the route guard.
    if (error?.code === '23514') {
      return { error: 'Finish setting up your account before posting.' }
    }
    // Everything else is RLS deciding this rider is not on this ride's crew,
    // which from their side reads as the ride being closed to them rather than
    // as a permission problem.
    return { error: 'That thread could not be started. You may no longer be on this ride.' }
  }

  invalidate(queryKeys.rides.threads(rideId))
  return { error: null, redirectTo: routes.rideThread(thread.id) }
}

/**
 * Posts one message into a ride thread.
 *
 * ## Why it takes an id instead of generating one
 *
 * `108` gives `ride_thread_messages.id` a default *and* leaves it
 * client-suppliable, for `034`'s reason: the composer draws the message the
 * instant it is sent, and when the real row arrives — by refetch or over the
 * Realtime channel — the two have to be recognised as the same message, or the
 * rider sees their own text twice. Matching on content is wrong in the ordinary
 * case rather than the exotic one (send "ok" twice and the second echo cancels
 * the first optimistic row); matching on `created_at` is worse, that being the
 * server's clock.
 */
export async function sendRideThreadMessage(
  threadId: string,
  body: string,
  messageId: string,
  /**
   * The ride the thread sits on, for the timeline's reply entry.
   *
   * **A parameter rather than a read**, because this action has the thread id
   * and the ride timeline's key is hung under the RIDE —
   * `['rides','detail',rideId,'threads','replies']` — which `threadMessages`'
   * `['rides','threads',threadId,'messages']` does not prefix. Without it a
   * rider posts in a thread, taps back, and the timeline does not show the
   * reply they just wrote until the entry goes stale.
   *
   * Optional so a caller that genuinely has no ride to hand still sends; the
   * thread screen reads it off `getRideThread`, which returns `ride_id` for
   * exactly this class of reason.
   */
  rideId?: string
): Promise<ActionState> {
  if (!threadId) return { error: 'That thread could not be found.' }

  const parsed = rideThreadMessageBodySchema.safeParse(body)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to send a message.' }

  const { error } = await supabase
    .from('ride_thread_messages')
    .insert({ id: messageId, thread_id: threadId, author_id: user.id, body: parsed.data })

  if (error) {
    // The gate or the length CHECK — see `createRideThread`.
    if (error.code === '23514') {
      return { error: 'Finish setting up your account before posting.' }
    }
    // `23505` is the primary key: this exact message id is already stored, which
    // is the retry path the suppliable id exists for — a caller keeping the id
    // across a retry after an ambiguous timeout. Treating it as success is right
    // for that caller and harmless here, where reaching it means a v4 collision;
    // what it must not do is report failure, because the message would be in the
    // thread and the rider would send it again. It discloses nothing: RLS
    // evaluates WITH CHECK before the index insert, so a non-crew rider is
    // refused `42501` and never reaches a duplicate-key error.
    if (error.code === '23505') {
      invalidateThreadMessage(threadId, rideId)
      return { error: null, sent: true }
    }
    return { error: 'Could not send that message. You may no longer be on this ride.' }
  }

  invalidateThreadMessage(threadId, rideId)
  return { error: null, sent: true }
}

/**
 * What a message appearing or disappearing moves: the thread's own list, and —
 * when the caller knows which ride — the ride timeline's reply entry, whose key
 * is hung under the ride rather than the thread and so is reached by neither
 * `threadMessages` nor `thread`.
 */
function invalidateThreadMessage(threadId: string, rideId?: string) {
  invalidate(queryKeys.rides.threadMessages(threadId))
  if (rideId) invalidate(queryKeys.rides.threadReplies(rideId))
}

/**
 * Erases a message the caller wrote — **the only path there is**.
 *
 * `ride_thread_messages` holds no DELETE grant and no DELETE policy,
 * deliberately: RLS applies the SELECT policy to a `DELETE` whose `WHERE` names
 * a column, and `supabase-js` issues exactly that form, so a rider who has left
 * the crew — or one blocked by the thread's author — would silently fail to
 * erase their own words while every other crew member kept reading them.
 * `delete_own_ride_thread_message` is `security definer` and re-checks
 * `author_id = auth.uid()` itself.
 *
 * **This closes a gap the chat it replaces actually had.** `docs/HANDOFF.md`
 * §Your own row survives the parent going out of view records `ride_messages`
 * as carrying a residual silent `DELETE 0` that `102` deliberately left open,
 * because hoisting past the `is_ride_crew` conjunct would have broken the
 * documented invariant that the table's audience is an INTERSECTION. A definer
 * function is not subject to the SELECT policy at all, so the replacement does
 * not inherit it.
 *
 * **Authorship is the whole test — there is no crew conjunct**, so a rider who
 * has left the ride can still retract what they wrote.
 */
export async function deleteOwnRideThreadMessage(
  messageId: string,
  threadId: string,
  /** The ride, for the timeline's reply entry — see `sendRideThreadMessage`.
   *  Deleting the newest message in a thread changes which message that entry
   *  names, or removes it. */
  rideId?: string
): Promise<ActionState> {
  if (!messageId || !threadId) return { error: 'That message could not be found.' }

  const supabase = await resolveSupabase()

  const { error } = await supabase.rpc('delete_own_ride_thread_message', { message: messageId })

  if (error) return { error: 'That message could not be deleted.' }

  invalidateThreadMessage(threadId, rideId)
  return { error: null }
}

/**
 * Removing a thread — `moderate_ride_thread`, `security definer`, re-checking
 * its authority in its own body.
 *
 * ## TWO authority arms, and the second one is easy to delete by accident
 *
 * `rides.organizer_id = auth.uid()` **OR** `ride_threads.author_id =
 * auth.uid()`. A thread's author removes their own; the ride's organizer
 * removes anyone's. Both go through this one RPC because `108` grants **no
 * DELETE on `ride_threads` at all**, to any role — so there is no policy path
 * for either of them.
 *
 * **Do not narrow this to the organizer alone.** `tasks.md` 2.16 named only that
 * arm while 2.8 forbade a DELETE policy, and between them a thread's author
 * could not remove their own thread — contradicting
 * `specs/ride-threads/spec.md`'s own scenario at line 263. Line 257 settles the
 * reading: *"a crew member who is neither the organizer nor the thread's author
 * SHALL be refused"*, which names the author as someone who is not. The
 * migration header, `RideThreadOptions` and `canRemoveRideThread` all carry both
 * arms; this docstring is the nearest one to the call site, so it is the one a
 * later author reads first.
 *
 * **It is still NOT `private.is_ride_crew`** — gating on crew would let any
 * rider on the ride delete any other's thread, which is not moderation — and
 * still not the club's owner or admin, because the resource is the ride and a
 * ride has no admin role.
 *
 * ## An RPC rather than a DELETE policy arm, for `moderateClubThread`'s reason
 *
 * RLS filters a DELETE by what the caller may READ, so an organizer who has
 * blocked a thread's author cannot see that thread and a policy-arm delete keyed
 * on its id matches zero rows — silently, PostgREST reporting success. A thread
 * is a persistent titled object every *other* crew member keeps reading, so the
 * block is not the remedy here and the moderation right must not depend on the
 * organizer being able to see the row.
 *
 * One refusal for "no such thread" and "not your ride" alike, so the message
 * must not speculate about which it was.
 */
export async function moderateRideThread(
  threadId: string,
  rideId: string
): Promise<ActionState> {
  if (!threadId || !rideId) return { error: 'That thread could not be found.' }

  const supabase = await resolveSupabase()

  // No `.select()` chained onto an RPC that returns void: it would ask
  // PostgREST for a representation of nothing.
  const { error } = await supabase.rpc('moderate_ride_thread', { thread: threadId })

  if (error) return { error: 'That thread could not be deleted.' }

  invalidate(queryKeys.rides.threads(rideId))
  invalidate(queryKeys.rides.thread(threadId))
  invalidate(queryKeys.rides.threadReplies(rideId))
  return { error: null, redirectTo: routes.rideThreads(rideId) }
}

/**
 * Advances this rider's read watermark for one thread to now (`108`, `081`'s
 * shape).
 *
 * **`last_read_at` is sent and then thrown away**, which looks redundant and is
 * not. `108` hangs a `BEFORE INSERT OR UPDATE` trigger that overwrites it with
 * server time, because the value is compared against
 * `ride_thread_messages.created_at` — server-owned, `created_at` being outside
 * the INSERT column grant — and a comparison spanning a phone's clock and the
 * database's is wrong in a way nothing logs.
 *
 * **Withholding the column grant instead would NOT work**, and the obvious
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
 * The invalidation is `rides.threadsUnread(rideId)` and nothing else. It is a
 * longer prefix than the list's, so it deliberately does **not** reach
 * `rides.threads` — this fires on every message arriving while the thread is
 * open, and refetching the ride's whole thread list each time would turn one
 * delivered message into two round trips.
 */
export async function markRideThreadSeen(threadId: string, rideId: string): Promise<void> {
  if (!threadId || !rideId) return

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('ride_thread_reads').upsert(
    {
      user_id: user.id,
      thread_id: threadId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,thread_id' }
  )

  invalidate(queryKeys.rides.threadsUnread(rideId))
}
