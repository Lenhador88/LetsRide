import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { rideMessageBodySchema } from '@/lib/validation/rides'
import type { ActionState } from '@/lib/actions/state'

/**
 * Posts one message into a ride's chat.
 *
 * ## Why it takes an id instead of generating one
 *
 * `034` gives `ride_messages.id` a default *and* leaves it client-suppliable, and
 * this parameter is the reason. The composer draws the message the instant it is
 * sent; when the real row arrives — by refetch or over the Realtime channel —
 * the two have to be recognised as the same message, or the rider sees their own
 * text twice for as long as the optimistic copy survives.
 *
 * Matching on content would be the alternative and it is wrong in the ordinary
 * case, not the exotic one: send "ok" twice and the second echo cancels the
 * first optimistic row. Matching on `created_at` is worse — that is the server's
 * clock, which the sender does not know. An id chosen before the request is the
 * only thing both sides can agree on, which is `.claude/agents/realtime.md`
 * §Ordering and identity.
 *
 * ## What is deliberately not checked here
 *
 * No crew check and no ride-visibility check. `034`'s INSERT policy delegates
 * both to `private.is_ride_crew`, so a rider who has not RSVP'd — or who left —
 * is refused by the database. Restating it would be a second copy of a rule RLS
 * owns, free to drift, and it would also be *weaker*: the client's copy could be
 * skipped by anyone posting with the publishable key, which ships in the bundle.
 *
 * `author_id` is set from the session rather than passed in for the same reason
 * the policy names `auth.uid()`: a parameter is something a caller can get wrong.
 */
export async function sendRideMessage(
  rideId: string,
  body: string,
  messageId: string
): Promise<ActionState> {
  if (!rideId) return { error: 'That ride could not be found.' }

  const parsed = rideMessageBodySchema.safeParse(body)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to send a message.' }

  const { error } = await supabase
    .from('ride_messages')
    .insert({ id: messageId, ride_id: rideId, author_id: user.id, body: parsed.data })

  if (error) {
    // Three refusals reach here and they need different words, because only one
    // of them is something the rider can act on.
    //
    // `23514` is the participation gate (`023`) or the length CHECK (`034`).
    // The length is already refused above by a schema mirroring that constraint,
    // so in practice this is the gate: an un-onboarded or un-consented rider.
    // The route guard sends them to the wizard, so reaching it means they got
    // past the guard — worth saying plainly rather than blaming the ride.
    if (error.code === '23514') {
      return { error: 'Finish setting up your account before posting.' }
    }
    // `23505` is the primary key: this exact message id is already stored.
    //
    // **Nothing in the app currently reaches this**, and saying so is the point.
    // An earlier version of this comment justified the branch as "a retry of a
    // request that succeeded" — but the composer generates the id *inside* its
    // submit handler and supabase-js does not retry POSTs, so no path re-sends
    // the same id. The branch is here for the shape the id makes *possible*: a
    // caller that keeps the id across a retry after an ambiguous timeout, which
    // is the only way to send exactly once over an unreliable link and is worth
    // not foreclosing.
    //
    // Treating it as success is right for that caller and harmless for this one,
    // where reaching it means a v4 uuid collision. What it must not do is report
    // failure: the message would be in the chat and the rider would send it
    // again. It discloses nothing either — RLS evaluates WITH CHECK before the
    // index insert, so a non-crew caller is refused `42501` and never sees a
    // duplicate-key error at all.
    if (error.code === '23505') {
      invalidateThread(rideId)
      return { error: null, sent: true }
    }
    // Everything else is RLS deciding this rider is not on this ride, which from
    // their side reads as the chat being gone rather than as a permission
    // problem — the same phrasing `setRideAttendance` uses for the same reason.
    return { error: 'Could not send that message. You may no longer be on this ride.' }
  }

  invalidateThread(rideId)
  // `sent` lets the composer tell "not submitted yet" from "submitted, nothing
  // to report" — both are `error: null` otherwise. This is the case
  // `lib/actions/state.ts` documents the flag for.
  return { error: null, sent: true }
}

/**
 * Advances this rider's read watermark for one ride's chat to now (`061`).
 *
 * `markClubSeen`'s shape, for `markClubSeen`'s reasons, with two differences
 * that are both about `061` rather than about this function.
 *
 * **`last_read_at` is sent and then thrown away**, which looks redundant and is
 * not. `061` hangs a `BEFORE INSERT OR UPDATE` trigger on the table that
 * overwrites it with server time, because the value is compared against
 * `ride_messages.created_at` — server-generated since `034` — and a comparison
 * spanning a phone's clock and the database's is wrong in a way nothing logs. It
 * is sent anyway so the upsert's UPDATE arm has the column in its `SET` list
 * explicitly rather than by inference about how PostgREST builds one. Two
 * visible mechanisms; the trigger is the one that makes the value true.
 *
 * **A failure is deliberately silent**, and the direction it fails in is the
 * safe one: the dot lights again on the next visit, which over-reports unread
 * rather than hiding a message. A chat that opens fine and keeps its badge beats
 * an error banner over a screen that worked.
 *
 * The invalidation is `rides.unread` and nothing else. It is a longer prefix
 * than the thread's, so it deliberately does **not** reach `rides.messages` —
 * this fires on every message arriving while the screen is open, and refetching
 * the thread the rider is reading would turn one delivered message into two
 * round trips and a re-render. See `keys.ts`.
 */
export async function markRideChatSeen(rideId: string): Promise<void> {
  if (!rideId) return

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('ride_reads')
    .upsert(
      { user_id: user.id, ride_id: rideId, last_read_at: new Date().toISOString() },
      { onConflict: 'user_id,ride_id' }
    )

  invalidate(queryKeys.rides.unread(rideId))
}

/**
 * Narrow on purpose, and the first invalidation in this app that is.
 *
 * Every other claim in `keys.ts` widened from a `revalidatePath`, because a
 * route re-render refetched everything the route drew. A message is genuinely
 * scoped: it does not move the rides list, the filter tiles, the card's
 * attendee collage or the crew roster. `rides.all()` here would refetch four
 * screens on every send, on a screen designed to be sent from repeatedly.
 *
 * **PD-120 widened it without touching this line**, which is what the previous
 * revision of this comment asked for: `rides.unread` is nested *under*
 * `rides.messages`, so the badge is reached by prefix and no second key is
 * spelled here. What that comment also predicted — that the widening would
 * matter — turned out to be false, and `keys.ts` now records why: this runs in
 * the author's own browser about their own message, which `061` never counts as
 * unread for its own author. The reach is correct and inert.
 */
function invalidateThread(rideId: string) {
  invalidate(queryKeys.rides.messages(rideId))
}
