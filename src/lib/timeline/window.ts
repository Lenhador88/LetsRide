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

/**
 * The exact-versus-floor rule for a per-thread reply count — **the club's own
 * `resolveThreadCount`, moved here when the ride grew a count of its own
 * (`116`, PD-439)**, for the reason `TimelineSource` lives here rather than in
 * `club-timeline.ts`: two copies of a rule this subtle drift, and the copy that
 * drifts is the one nobody reads.
 *
 * A count is derived from a bounded MESSAGE window, so it counts what was
 * fetched rather than what exists. It is exact when the reply source's
 * accumulated horizon is `null` — nothing of any thread is outside it — or when
 * the thread is KNOWN to have been created at or after that horizon, in which
 * case every message it can have is inside the coverage. Otherwise the number
 * is a floor and `partial` is what lets the row draw `12+` rather than assert a
 * total it cannot know.
 *
 * **Derived from coverage, never accumulated.** A flag set true because some
 * window once saturated is monotonic — it never clears — so a thread whose every
 * message is demonstrably in hand would keep announcing a floor even after the
 * stream reached the club's founding.
 *
 * **`threadCreatedAt` is the thread's CREATION, never its `last_activity_at`.**
 * Since `116` a thread row sits at its newest activity, so the two differ on
 * exactly the threads this matters for: an old thread with a fresh reply is
 * drawn at the top while its earlier messages are genuinely outside the window,
 * and comparing the bumped stamp against the horizon would call that count
 * exact.
 */
export function resolveThreadCountExactness<A extends { partial: boolean }>(
  activity: A | undefined,
  repliesHorizon: string | null,
  threadCreatedAt: string | undefined
): A | null {
  if (!activity) return null
  const exact =
    repliesHorizon === null ||
    (threadCreatedAt !== undefined && threadCreatedAt >= repliesHorizon)
  return { ...activity, partial: !exact }
}
