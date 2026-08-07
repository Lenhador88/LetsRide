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
    // `23505` is the primary key: this exact message id is already stored. That
    // means a retry of a request that actually succeeded — the first attempt
    // landed and its response was lost. The message is in the chat, so reporting
    // a failure would be a lie that makes the rider send it twice.
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
 * Narrow on purpose, and the first invalidation in this app that is.
 *
 * Every other claim in `keys.ts` widened from a `revalidatePath`, because a
 * route re-render refetched everything the route drew. A message is genuinely
 * scoped: it does not move the rides list, the filter tiles, the card's
 * attendee collage or the crew roster. `rides.all()` here would refetch four
 * screens on every send, on a screen designed to be sent from repeatedly.
 *
 * The unread badge (Linear PD-120) is what widens this, and it should widen it
 * in `keys.ts` rather than at this call site — a second key spelled here is the
 * bug that file exists to prevent.
 */
function invalidateThread(rideId: string) {
  invalidate(queryKeys.rides.messages(rideId))
}
