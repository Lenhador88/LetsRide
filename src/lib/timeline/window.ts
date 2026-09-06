/**
 * The parts of a timeline that are not about clubs.
 *
 * `lib/data/club-timeline.ts` was the only timeline in the app until PD-393
 * gave the ride one, and these two definitions are the pieces both need: what
 * a bounded read contributes, and how far back it looked. They moved here
 * rather than being imported across domains — a ride module reaching into
 * `lib/data/club-timeline` for a type would make the club the ride's
 * dependency, which is backwards and reads as an accident at every later call
 * site.
 *
 * **Only the genuinely shared pieces are here.** Everything the club's paged
 * stream needs and the ride's does not — `ClubTimelineWindow`,
 * `absorbClubTimelineWindow`, the advance and tail-state resolvers — stays in
 * `club-timeline.ts`, because a ride is a bounded event rather than a place
 * that accumulates for ever and reads both its sources whole. Lifting those
 * too would be generalising against one consumer, which `CLAUDE.md` §8's last
 * line already refuses for a different subject.
 */

/** What each source contributed, and how far back it looked. */
export type TimelineSource<T> = {
  rows: T[]
  /**
   * The instant below which THIS source's picture is incomplete, or `null` when
   * it reaches back to the beginning.
   *
   * **It is the oldest row the READ returned, which is not always the oldest
   * row in `rows`.** That distinction is the whole reason this is a field the
   * source declares rather than something the merge derives: a read that
   * post-processes its window — `getClubJoins` and `getRideJoins` both drop
   * riders they cannot name, `getClubThreadReplies` collapses a conversation
   * to one entry — knows how far back it actually looked, and the merge,
   * holding only the survivors, does not. Deriving it from `rows` made a
   * sixty-message window in one thread report a horizon at that thread's
   * latest message, and cut the club's whole history to the last hour.
   */
  horizon: string | null
}

/**
 * The horizon for a read that returns exactly what it fetched, in the order it
 * sorts on: full means there is more behind, and the last row is how far back
 * we looked.
 *
 * Only for sources whose `rows` ARE the window. A read that filters or collapses
 * must compute its own from the rows it discarded — see `TimelineSource`.
 */
export function boundedHorizon<T>(rows: T[], bound: number, at: (row: T) => string): string | null {
  return rows.length >= bound && rows.length > 0 ? at(rows[rows.length - 1]) : null
}
