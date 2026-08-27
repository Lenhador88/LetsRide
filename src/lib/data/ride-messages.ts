import { resolveSupabase } from '@/lib/supabase/resolve'
import { decorateChat } from '@/lib/data/chat'
import { unwrapList } from '@/lib/data/unwrap'
import { rideIdSchema } from '@/lib/validation/rides'
import type { RideChatMessage, RideMessage } from '@/types'

/**
 * How much of a thread the chat screen reads.
 *
 * Bounded for the same reason `RIDE_CREW_LIMIT` is, and more urgently: nothing
 * caps how many messages a ride can hold, and unlike a crew it grows without
 * anyone joining anything. Unbounded, a ride planned two months out selects
 * every message plus a joined profile each, on every mount, onto a 390px screen
 * with no virtualisation.
 *
 * **This is the newest N, not the oldest**, which is the one place this read
 * differs from `getPostcardComments` — see the `.order()` dance below. A comment
 * thread truncated at the top loses the reply nobody has read; a chat truncated
 * at the top loses the message someone just sent.
 *
 * Beyond this the thread truncates rather than misleads, the same saturating
 * trade the rides reads make. The real fix is a cursor and an "earlier messages"
 * affordance, which the design does not draw — so it waits for a design rather
 * than getting a scroll behaviour invented for it.
 */
export const RIDE_MESSAGES_PAGE_SIZE = 200

/**
 * One ride's chat, oldest first, as the screen renders it.
 *
 * ## What is deliberately NOT here
 *
 * No crew check, no block filter, no ride-visibility predicate. `034`'s SELECT
 * policy owns all three — `private.is_ride_crew(ride_id)` plus the symmetric
 * `private.is_blocked` arm — so "which messages may this rider see" is already
 * answered by the time rows come back. Restating any of it would be the drift
 * trap `getPostcardComments` and `getRideCrew` both call out: a second copy of a
 * predicate, free to disagree with the policy it duplicates, and the copy that
 * drifts is always the one nobody reads.
 *
 * That has a consequence worth stating, because it looks like a bug from the
 * outside: **a non-crew rider gets `[]`, not an error.** Empty is what RLS
 * returns for "not yours to see", and it is indistinguishable here from a chat
 * nobody has written in. The screen tells them apart with the ride's own
 * `attendance`/`is_organizer`, which it already has — see the chat page.
 *
 * ## The two-`order` shape
 *
 * PostgREST applies `limit` after `order`, so reading the *newest* 200 means
 * ordering descending, and rendering them means ascending. The reverse happens
 * here rather than in the component because the grouping below walks the list in
 * render order and would otherwise be computing runs backwards.
 */
export async function getRideMessages(rideId: string): Promise<RideChatMessage[] | null> {
  // Same guard, same reason as `getRide`: a non-UUID segment reaches
  // `.eq('ride_id', …)` as `22P02`, which PostgREST turns into a 400 and
  // `unwrapList` throws — so a hand-edited URL would land on the error boundary
  // offering "Try again" on an address that can never succeed. `null` routes it
  // through the same `notFound()` a hidden ride gets.
  if (!rideIdSchema.safeParse(rideId).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const rows = unwrapList(
    await supabase
      .from('ride_messages')
      // `username` only — deliberately NOT `PUBLIC_PROFILE_COLUMNS`, which the
      // other reads use. That constant carries `avatar_path`, and signing it is
      // a `createSignedUrls` round trip per distinct author; the design draws no
      // avatar on a chat bubble at all, so every one of those URLs would be
      // minted for nothing. It would also be *per message*, because a live
      // thread refetches on every arrival. Add the column back the day a bubble
      // grows an avatar, and add the `resolveAvatarUrls` pass with it.
      .select(`id, ride_id, author_id, body, created_at, author:profiles!author_id(id, username)`)
      .eq('ride_id', rideId)
      // Both columns, matching `034`'s index. `created_at` alone is not a total
      // order — two messages sent in the same millisecond, or written in one
      // transaction where `now()` is identical, sort arbitrarily and the same
      // thread renders differently on two devices.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(RIDE_MESSAGES_PAGE_SIZE),
    'this ride chat',
  ) as unknown as RideMessage[]

  rows.reverse()

  return decorate(rows, user?.id)
}

/**
 * Does this ride's chat hold a message this rider has not read (`061`)?
 *
 * One RPC, one boolean. Everything that decides the answer lives in
 * `ride_has_unread`, which is `security invoker` — so `034`'s SELECT policy
 * applies inside it and blocks, ride visibility and the crew rule are all
 * honoured by the same policy the thread obeys. **No block filter, no crew check
 * and no visibility predicate appear here**, for the reason `getRideMessages`
 * gives at length: a second copy of a policy is free to disagree with it, and
 * the copy that drifts is always the one nobody reads.
 *
 * `false` rather than an exception when the read fails, and that is a product
 * decision rather than defensive coding. `NotificationsHeaderControl` already
 * rules the same way: *"a dot the rider cannot clear by visiting the screen is
 * worse than a missing one"*. The dot decorates a chat button that works without
 * it, so a failure must cost the decoration and nothing else — it must not reach
 * the screen's error state, and it must not draw a mark the rider cannot clear.
 *
 * **The caller still has to tell `false` from "not answered yet"**, which this
 * cannot express and `useQuery` can: `undefined` draws nothing, exactly as
 * `false` does. See `RideChatButton`, which owns that read.
 */
export async function getRideChatUnread(rideId: string): Promise<boolean> {
  // Same guard, same reason as `getRideMessages`: a non-UUID segment reaches
  // Postgres as `22P02`. There is no `notFound()` to route to from a decoration,
  // so it resolves to "no dot" like every other failure here.
  if (!rideIdSchema.safeParse(rideId).success) return false

  const supabase = await resolveSupabase()
  const { data, error } = await supabase.rpc('ride_has_unread', { ride: rideId })

  return !error && data === true
}

/**
 * Resolves "is this mine" once per read, then groups — `decorateChat` typed to
 * this table's row. The grouping itself lives in `lib/data/chat.ts` since `081`,
 * shared with the club discussion thread; this wrapper is what keeps
 * `getRideMessages`' return type exactly `RideChatMessage[]`.
 */
export function decorate(rows: RideMessage[], viewerId: string | undefined): RideChatMessage[] {
  return decorateChat(rows, viewerId)
}
