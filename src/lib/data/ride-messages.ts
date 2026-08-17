import { resolveSupabase } from '@/lib/supabase/resolve'
import { unwrapList } from '@/lib/data/unwrap'
import { rideIdSchema } from '@/lib/validation/rides'
import { rideZoneDayKey } from '@/lib/utils'
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
 * Adds the two positional flags the bubbles render from — pure, exported, and
 * tested directly.
 *
 * Separate from the query for the reason `withOrganizer` is separate from
 * `getRideCrew`: it encodes presentation *rules* rather than a fetch, and a rule
 * that can be checked without a database is one that gets checked.
 *
 * `startsGroup` is the design's `Section` — consecutive messages from one rider
 * draw the author's name once, on the first. `startsDay` is the separator this
 * screen adds. Both are properties of a message's *position* in the list, which
 * is why they are computed over the sequence rather than by each bubble asking
 * about its neighbour.
 *
 * A day boundary always starts a group too, even from the same rider: a run of
 * messages spanning midnight with the name drawn only above the pre-midnight one
 * puts the name on the far side of a separator from the messages it labels.
 *
 * **It is exported because the screen re-runs it**, which is the whole reason it
 * is a separate function rather than a loop inside the read. A message being
 * sent is drawn before the database has it, so the rendered list is the fetched
 * one plus the optimistic rows — and grouping computed over the fetched list
 * alone would give the *first* optimistic message no name when it should have
 * one, or a redundant one when it should not. Recomputing over the list actually
 * being drawn is the only version that is right in both cases.
 */
export function groupMessages(
  rows: readonly (RideMessage & { mine: boolean; pending?: boolean })[]
): RideChatMessage[] {
  let previousAuthor: string | null = null
  let previousDay: string | null = null

  return rows.map((row) => {
    // **Not `row.author_id`**, and the difference is load-bearing for the one
    // case this function is re-run for. An optimistic row is built before the
    // server has said anything, so it has no `author_id` to carry — the screen
    // knows only that the message is the viewer's. Keying on the raw column
    // therefore broke every optimistic message out of its own run, and the unit
    // test asserting otherwise passed only because its fixture invented an
    // `author_id` the screen never has.
    //
    // "Mine" is a complete author identity for grouping: two consecutive `mine`
    // rows are the same rider by definition, and a `mine` row can never be the
    // same rider as one that is not.
    const author = row.mine ? '@me' : row.author_id
    const day = rideZoneDayKey(row.created_at)
    const startsDay = day !== previousDay
    const startsGroup = startsDay || author !== previousAuthor

    previousAuthor = author
    previousDay = day

    return { ...row, startsGroup, startsDay }
  })
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
 * `false` does. See `RideChatUnreadDot`.
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

/** Resolves "is this mine" once per read, then groups. See `groupMessages`. */
export function decorate(rows: RideMessage[], viewerId: string | undefined): RideChatMessage[] {
  return groupMessages(
    // `false` for a signed-out viewer rather than crashing, though this read
    // returns nothing for one anyway: `anon` holds zero grants on the table.
    rows.map((row) => ({ ...row, mine: !!viewerId && row.author_id === viewerId }))
  )
}
