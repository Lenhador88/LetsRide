import { rideZoneDayKey } from '@/lib/utils'

/**
 * The positional flags every chat bubble renders from, shared by the app's two
 * message streams — a ride's chat (`034`) and a club discussion (`081`).
 *
 * **It moved here from `lib/data/ride-messages.ts` unchanged**, and the move is
 * the point: copying it would give the repo two grouping rules free to disagree
 * about where a name or a separator goes, which is the same argument
 * `lib/data/` itself rests on. Its tests moved with it and assert the same
 * cases.
 *
 * Pure, exported and tested directly, for the reason `withOrganizer` is separate
 * from `getRideCrew`: it encodes presentation *rules* rather than a fetch, and a
 * rule that can be checked without a database is one that gets checked.
 */

/** The columns the grouping actually reads — deliberately not a message type.
 * A ride message carries `ride_id` and a club message `discussion_id`; neither
 * decides where a separator goes. */
type Groupable = {
  id: string
  author_id: string
  created_at: string
  mine: boolean
  pending?: boolean
}

/**
 * Adds `startsGroup` and `startsDay` over a list in render order.
 *
 * `startsGroup` is the design's `Section` — consecutive messages from one rider
 * draw the author's name once, on the first. `startsDay` is the separator the
 * chat screens add (see `formatChatMessageDay`). Both are properties of a
 * message's *position* in the list, which is why they are computed over the
 * sequence rather than by each bubble asking about its neighbour.
 *
 * A day boundary always starts a group too, even from the same rider: a run of
 * messages spanning midnight with the name drawn only above the pre-midnight one
 * puts the name on the far side of a separator from the messages it labels.
 *
 * **It is exported because the screens re-run it**, which is the whole reason it
 * is a separate function rather than a loop inside the read. A message being
 * sent is drawn before the database has it, so the rendered list is the fetched
 * one plus the optimistic rows — and grouping computed over the fetched list
 * alone would give the *first* optimistic message no name when it should have
 * one, or a redundant one when it should not. Recomputing over the list actually
 * being drawn is the only version that is right in both cases.
 */
export function groupMessages<T extends Groupable>(
  rows: readonly T[]
): (T & { startsGroup: boolean; startsDay: boolean })[] {
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
    // One fixed zone for both streams, so two riders never see a separator in
    // different places — see that function, and note the name is the ride
    // chat's inheritance rather than a claim that a discussion has a zone.
    const day = rideZoneDayKey(row.created_at)
    const startsDay = day !== previousDay
    const startsGroup = startsDay || author !== previousAuthor

    previousAuthor = author
    previousDay = day

    return { ...row, startsGroup, startsDay }
  })
}

/** Resolves "is this mine" once per read, then groups. See `groupMessages`. */
export function decorateChat<T extends { id: string; author_id: string; created_at: string }>(
  rows: T[],
  viewerId: string | undefined
): (T & { mine: boolean; startsGroup: boolean; startsDay: boolean })[] {
  return groupMessages(
    // `false` for a signed-out viewer rather than crashing, though these reads
    // return nothing for one anyway: `anon` holds zero grants on either table.
    rows.map((row) => ({ ...row, mine: !!viewerId && row.author_id === viewerId }))
  )
}
