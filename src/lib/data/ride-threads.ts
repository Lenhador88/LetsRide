import { resolveSupabase } from '@/lib/supabase/resolve'
import { decorateChat } from '@/lib/data/chat'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import { rideIdSchema, rideThreadIdSchema } from '@/lib/validation/rides'
import type {
  RideThreadChatMessage,
  RideThreadCursor,
  RideThreadDetail,
  RideThreadListItem,
  RideThreadMessage,
} from '@/types'

/**
 * A ride's threads — `108`, PD-402, replacing `034`'s single chat stream.
 *
 * **This is the club's `lib/data/club-threads.ts` one domain over**, with the
 * audience swapped from club membership to `private.is_ride_crew` ∩ ride
 * visibility. The two files are meant to read the same; where this one diverges
 * it says so.
 *
 * **What is deliberately NOT here, in every function below**: no crew check, no
 * ride-visibility predicate, no block filter. `108`'s SELECT policies own all
 * three — the `EXISTS` against `rides` evaluated as the caller,
 * `private.is_ride_crew`, and the symmetric `private.is_blocked` arm on
 * `author_id` — so "which threads may this rider see" is answered by the time
 * rows come back. Restating any of it here would be a second copy of a policy,
 * free to drift, and the copy that drifts is always the one nobody reads.
 *
 * **The audience is an INTERSECTION and neither half alone is it**, which is
 * `034`'s own recorded trap: its first draft substituted `is_ride_crew` for the
 * club's membership helper and dropped the `rides` EXISTS, which shipped a leak.
 * `108` carries both conjuncts and comments each one; nothing in this file
 * relies on either.
 *
 * **There is no announcement marker here.** `club_threads.introduces_user_id`
 * is `097`'s club introduction and has no ride counterpart, so every predicate
 * in `getClubThreads` that mentions it is absent rather than ported — a ride has
 * no join ceremony to draw twice.
 */

/**
 * How many threads one page of a ride's Threads list reads.
 *
 * The club's twenty, and keyset-paged rather than truncated for the same
 * reason: a ride's threads are worth reaching after the ride, and
 * `(created_at, id)` carries a cursor.
 */
export const RIDE_THREADS_PAGE_SIZE = 20

/**
 * How much of one thread the screen reads — the club's two hundred, and its
 * whole argument, including that this is the **newest** N rather than the
 * oldest. See the two-`order` dance in `getRideThreadMessages`.
 */
export const RIDE_THREAD_MESSAGES_PAGE_SIZE = 200

const THREAD_SELECT = `
  id, ride_id, author_id, title, created_at, last_activity_at,
  author:profiles!author_id(id, username)
`

/**
 * One page of a ride's threads, newest created first.
 *
 * `created_at DESC, id DESC` matches `108`'s index and is a total order; a
 * cursor over `created_at` alone would skip or repeat rows exactly at the
 * boundary where two threads share one `now()`.
 *
 * **Newest created, not most recently active — and this list is now the ONLY
 * place that is still true.** `116` (PD-439) gave both thread tables a stored
 * `last_activity_at` and moved both TIMELINES onto it, on the product owner's
 * explicit choice between three options. This read is unchanged because nothing
 * calls it (`git grep -n "getRideThreads(" -- src/ | grep -v __tests__` is 0)
 * and its `(created_at, id)` cursor matches its own ordering; a screen that
 * brings it back decides for itself, and must move the cursor with the order.
 *
 * **The visibility objection this paragraph used to make is real, was not
 * refuted, and is now an accepted cost — do not read the change as having
 * answered it.** A stored stamp is global and blocking is per-viewer, so a
 * message from a rider you blocked bumps its thread on your timeline. What
 * leaks is ORDERING only: `private.is_blocked` still removes the message
 * itself, so the reply source returns nothing for it, the lead line and the
 * count never mention it, and the row moves with no visible cause.
 *
 * **In a small club or crew that is ATTRIBUTABLE, which is the part worth
 * stating plainly.** A row that moves with no new visible message and no change
 * to its count tells you that the person you blocked posted, and when, to the
 * second — and blocks are symmetric, so it runs both ways. Before `116` a
 * blocked rider's reply produced no row at all, so this is a NEW channel rather
 * than a widening of an existing one. Content, identity and counts stay gated.
 *
 * **There is no cheap mitigation, and the obvious one is worse.** Positioning
 * the row on the newest VISIBLE reply puts it below the `last_activity_at`
 * horizon the read bounded on, so the thread drops out of the stream entirely
 * rather than merely sitting too high. Computing the position live per viewer
 * is the only version without the channel, and it is an aggregate over every
 * row of the list — which is why it was refused rather than built. Recorded on
 * PD-439.
 *
 * A rider who can see the ride but is not on its crew reads `[]` here, which is
 * indistinguishable from a ride nobody has posted in — the screen tells those
 * apart with the ride's own `is_crew`, which `getRide` already carries. That is
 * a UX affordance and never the enforcement.
 */
export async function getRideThreads(
  rideId: string,
  cursor?: RideThreadCursor,
  limit = RIDE_THREADS_PAGE_SIZE
): Promise<RideThreadListItem[] | null> {
  // The guard every ride-scoped read carries: a non-uuid reaches
  // `.eq('ride_id', …)` as `22P02`, PostgREST turns it into a 400 and
  // `unwrapList` throws — which would put a rider on an error boundary offering
  // `Try again` on an address that can never succeed (PD-142). `null` routes it
  // through the same `notFound()` a ride nobody may see gets.
  if (!rideIdSchema.safeParse(rideId).success) return null

  const supabase = await resolveSupabase()

  let query = supabase
    .from('ride_threads')
    .select(THREAD_SELECT)
    .eq('ride_id', rideId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    )
  }

  return unwrapList(await query, "this ride's threads") as unknown as RideThreadListItem[]
}

/**
 * One thread, or `null` for one that does not exist **or** that this rider may
 * not see — deliberately indistinguishable, the same refusal `getRide` makes.
 *
 * The thread screen needs `ride_id` from this rather than from the URL: the
 * route names the thread, and `Back`, the watermark's cache key and the
 * moderation affordance are all built from the ride.
 */
export async function getRideThread(id: string): Promise<RideThreadDetail | null> {
  if (!rideThreadIdSchema.safeParse(id).success) return null

  const supabase = await resolveSupabase()

  return unwrap(
    await supabase
      .from('ride_threads')
      .select(THREAD_SELECT)
      // `maybeSingle`, not `single`: RLS answers a thread this rider may not
      // read with zero rows, and `single` turns that into a PostgREST error
      // (`PGRST116`) which `unwrap` would throw — an error screen where the rest
      // of the app renders not-found.
      .eq('id', id)
      .maybeSingle(),
    'this thread'
  ) as RideThreadDetail | null
}

/**
 * One thread's messages, oldest first, as the screen renders them.
 *
 * The two-`order` dance is `getClubThreadMessages`': PostgREST applies `limit`
 * after `order`, so reading the *newest* 200 means ordering descending, and
 * rendering them means ascending. The reverse happens here rather than in the
 * component because the grouping walks the list in render order.
 *
 * `username` only on the embed — no `avatar_path`, because the design draws no
 * avatar on a bubble and signing one would be a round trip per distinct author
 * on a screen that refetches on every arrival.
 *
 * **A blocked pair both writing in one thread is a designed state, not a gap.**
 * `108` carries no block arm in either WITH CHECK — refusing the insert would
 * disclose the block to the poster — so both inserts succeed and each rider's
 * SELECT hides the other's row. The screen must not present the resulting
 * one-sided conversation as an error.
 */
export async function getRideThreadMessages(
  threadId: string
): Promise<RideThreadChatMessage[] | null> {
  if (!rideThreadIdSchema.safeParse(threadId).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const rows = unwrapList(
    await supabase
      .from('ride_thread_messages')
      .select(`id, thread_id, author_id, body, created_at, author:profiles!author_id(id, username)`)
      .eq('thread_id', threadId)
      // Both columns, matching `108`'s index. `created_at` alone is not a total
      // order — two messages written in one transaction carry an identical
      // `now()` and the same thread renders differently on two devices.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(RIDE_THREAD_MESSAGES_PAGE_SIZE),
    'this thread'
  ) as unknown as RideThreadMessage[]

  rows.reverse()

  return decorateChat(rows, user?.id)
}

/**
 * Which of a ride's threads hold a message this rider has not read (`108`).
 *
 * One RPC for the whole list, answering `(thread_id, has_unread)`.
 * `ride_thread_unread` is **`security invoker`** — measured on the club's
 * equivalent, `public.club_thread_unread` is `prosecdef = false` — so `108`'s
 * SELECT policies decide what counts and blocks are honoured by the same policy
 * the thread obeys.
 *
 * A failure resolves to "nothing is unread" rather than throwing, and that is a
 * product decision rather than defensive coding: the marks decorate a list that
 * works without them, so a failed unread call must cost the decoration and
 * nothing else — the list still renders, unmarked. The reverse is what must
 * never be drawn, and cannot be from here: a mark can only ever appear beside a
 * thread the list itself returned.
 *
 * **No corrective read, unlike `getClubThreadUnread`.** That one subtracts the
 * club's announcements because `097`'s introductions are threads the Threads
 * list does not show; a ride has no announcements, so every thread the RPC can
 * mark is a thread the list draws, and there is nothing to reconcile.
 */
export async function getRideThreadUnread(rideId: string): Promise<Record<string, boolean>> {
  if (!rideIdSchema.safeParse(rideId).success) return {}

  const supabase = await resolveSupabase()
  const { data, error } = await supabase.rpc('ride_thread_unread', { ride: rideId })

  if (error || !data) return {}

  const rows = data as { thread_id: string; has_unread: boolean }[]

  return Object.fromEntries(rows.map((row) => [row.thread_id, row.has_unread]))
}
