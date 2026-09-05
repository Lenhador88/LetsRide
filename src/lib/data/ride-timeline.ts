import { MEMBER_PROFILE_EMBED } from '@/lib/data/columns'
import { resolveAvatarUrls } from '@/lib/data/media'
import { unwrapList } from '@/lib/data/unwrap'
import { resolveSupabase } from '@/lib/supabase/resolve'
import { boundedHorizon, type TimelineSource } from '@/lib/timeline/window'
import { rideIdSchema } from '@/lib/validation/rides'
import type { Postcard, PublicProfile } from '@/types'

/**
 * The ride's timeline — the club's screen shape, one domain over (PD-393).
 *
 * Product owner, 2026-09-05: *"Similar to the club list, we need to adopt a
 * timeline… at the top we will keep a sort of header with relevant information
 * about the ride. But then, we will have the timeline with the postcards,
 * announcements (someone joins the ride, etc.)."*
 *
 * ## What this borrows from the club, and the one thing it deliberately does not
 *
 * The **horizon** model is borrowed whole, because it is the part that is easy
 * to get silently wrong: two independently-bounded reads concatenated and
 * sorted produce a tail that is not merely short but **wrong** — a ride whose
 * crew read filled at last Tuesday would show every postcard older than that
 * with no joins beside them, and a reader cannot tell "nobody joined" from "we
 * stopped looking". So each source declares how far back it looked, the merge
 * cuts at the newest of those points, and the screen says so at the foot.
 *
 * **Paging is NOT borrowed**, and that is a decision rather than an omission.
 * `ClubTimeline`'s window machinery — `ClubTimelineWindow`,
 * `absorbClubTimelineWindow`, the five `extra*` states, `fetchNextWindow`,
 * the anchor hunt — exists because a club accumulates for ever and its five
 * sources advance at five different rates. **A ride is a bounded event**: it
 * happens once, its crew is capped in practice by who turns up, and its
 * journal is the photos of one day. Both of its sources are read whole at
 * bounds set here, and a ride that overruns them is cut at the horizon and
 * handed off to the crew list and the photos — the same honest foot, without
 * a thousand lines of paging to keep correct. Lifting that machinery for one
 * more consumer that does not need it is generalising ahead of the need.
 *
 * If a ride ever does overrun these bounds routinely, the club's model is the
 * answer and it is already written; this is the point to come back to.
 */

/**
 * A rider arriving on a ride's crew, as the timeline draws them.
 *
 * `profile.username` is narrowed to non-null because the whole content of a
 * join row IS the rider's name — `getRideJoins` drops the rest at the read,
 * on `getClubJoins`' reasoning: "someone joined the ride" is not an event, it
 * is a shrug.
 */
export type RideJoin = {
  user_id: string
  status: 'going' | 'maybe'
  joined_at: string
  profile: PublicProfile & { username: string }
}

/** How many entries one page of the ride timeline draws. Same twenty the club
 *  uses, and for the same reason: it is a page size the rider extends for free,
 *  never a ceiling — nothing below it is fetched, so raising the cap costs no
 *  read at all. */
export const RIDE_TIMELINE_LIMIT = 20

/**
 * How far back the join read looks.
 *
 * Sized against `RIDE_CREW_LIMIT` (200) rather than against the display cap:
 * the crew page shows up to two hundred riders, and a timeline that stopped
 * at twenty joins would report a horizon at last week on any ride with a real
 * crew — cutting the postcards below it for no reason a rider could see. Sixty
 * is the club's own join bound, chosen there because it is well past what any
 * real screen draws while staying one round trip.
 */
export const RIDE_TIMELINE_JOINS = 60

/**
 * One thing that happened on a ride.
 *
 * A discriminated union carrying the domain object rather than a flattened
 * `{ icon, sentence, href }`, for `ClubTimelineEvent`'s reason: the copy and
 * the destination are the component's business, and a data module that decided
 * them would have to be edited for a wording change.
 */
export type RideTimelineEvent =
  | { kind: 'postcard'; at: string; key: string; postcard: Postcard }
  | { kind: 'join'; at: string; key: string; member: RideJoin }
  /**
   * The ride itself — `rides.created_at`, the oldest thing that can be on this
   * stream and therefore its floor.
   *
   * **Appended only when the stream is COMPLETE**, which is what `complete`
   * answers. On a cut stream it would sit directly under an entry from last
   * Tuesday and assert that nothing happened in between — a false adjacency,
   * and a worse lie than the missing rows, because it reads as the end of the
   * story. `club-created`'s rule, unchanged.
   *
   * `organizer` is null when the `profiles` policy hides them; the sentence
   * loses its subject rather than the entry disappearing.
   */
  | { kind: 'ride-planned'; at: string; key: string; organizer: string | null }

export type RideTimelineSources = {
  /** The ride's own founding, for the floor entry, plus the organizer id the
   *  merge needs to suppress their crew row — see `mergeRideTimeline`. */
  ride: { created_at: string; organizer_id: string; organizer: string | null }
  postcards: TimelineSource<Postcard>
  joins: TimelineSource<RideJoin>
}

export type RideTimeline = { events: RideTimelineEvent[]; complete: boolean }

/**
 * The merge. Two RLS-filtered lists in, one chronological list out.
 *
 * ## The organizer's own crew row is dropped, and it is not a cosmetic choice
 *
 * `103` (PD-103) made the creator's membership a database invariant, so **every
 * ride has a `ride_members` row for its organizer, written in the ride's own
 * transaction**. Drawn, that is "Pedro joined the ride." sitting on top of
 * "Pedro planned this ride." at the foot of every single ride in the app,
 * always, at the same instant — a row that carries no information and cannot
 * be absent. The founding entry already says the organizer is on it.
 *
 * Dropped in the merge rather than in the read, because the read does not know
 * who the organizer is and `getRideJoins` is not the place to teach it. The
 * horizon is unaffected: it comes from what the READ looked at, which is the
 * whole point of a source declaring its own (`TimelineSource.horizon`).
 *
 * ## Why this is a client-side merge and not one SQL union
 *
 * `mergeClubTimeline`'s answer, unchanged: a `security definer` RPC unioning
 * the tables would bypass RLS in its own body, so every audience rule — the
 * ride's four SELECT arms, the postcard qual, the symmetric block predicate on
 * two different author columns — would have to be restated inside it, and a
 * restated policy is a second copy free to drift. Two ordinary reads keep every
 * row filtered by the policy that owns it.
 */
export function mergeRideTimeline(
  sources: RideTimelineSources,
  limit = RIDE_TIMELINE_LIMIT
): RideTimeline {
  const events: RideTimelineEvent[] = [
    ...sources.postcards.rows.map(
      (postcard): RideTimelineEvent => ({
        kind: 'postcard',
        at: postcard.created_at,
        key: `postcard:${postcard.id}`,
        postcard,
      })
    ),
    ...sources.joins.rows
      .filter((member) => member.user_id !== sources.ride.organizer_id)
      .map(
        (member): RideTimelineEvent => ({
          kind: 'join',
          at: member.joined_at,
          key: `join:${member.user_id}`,
          member,
        })
      ),
  ]

  const horizons = [sources.postcards.horizon, sources.joins.horizon].filter(
    (at): at is string => at !== null
  )

  // Lexicographic on ISO-8601 rather than parsed: both are UTC strings from
  // Postgres, and `Math.max` over dates would turn an unparseable stamp into
  // `NaN`, which compares false against everything and would silently drop the
  // horizon rather than fail.
  const horizon = horizons.length > 0 ? horizons.reduce((a, b) => (a > b ? a : b)) : null

  const inside = events.filter((event) => horizon === null || event.at >= horizon)
  const ordered = inside.sort(byNewestThenKey)
  const shown = ordered.slice(0, limit)

  /**
   * Complete means nothing was dropped at either end: **no source declared a
   * horizon at all**, and the limit cut nothing. Only then does the ride's own
   * founding sit legitimately under the oldest entry — see `ride-planned`.
   *
   * **The first half is deliberately stronger than "the horizon filter dropped
   * nothing", which is what `mergeClubTimeline` asks.** A declared horizon
   * means that source's picture stops there, whether or not any OTHER source
   * happened to have a row below it — so a stream whose only full source is
   * also its only source passes the weaker test while genuinely having rows
   * behind it, and then appends the floor entry, which reads as the end of the
   * story. On the club that is unreachable through four of its five sources
   * (a full read there returns at least `CLUB_TIMELINE_LIMIT` rows, so the
   * display cap always cuts first) and reachable through the fifth, which
   * collapses its window — noted rather than fixed here, because it is a live
   * screen and not this change's.
   */
  const complete = horizon === null && shown.length === ordered.length

  if (complete) {
    shown.push({
      kind: 'ride-planned',
      at: sources.ride.created_at,
      key: `ride-planned:${sources.ride.organizer_id}`,
      organizer: sources.ride.organizer,
    })
    // Re-sorted rather than appended blind: the floor is the oldest thing that
    // can exist, but `103` writes the organizer's crew row in the ride's own
    // transaction, so a `joined_at` and `rides.created_at` sharing an instant
    // to the microsecond is the NORM here rather than a coincidence — and
    // although that particular row is filtered out above, a rider joining
    // inside the same statement pair is not a case to leave to luck.
    shown.sort(byNewestThenKey)
  }

  return { events: shown, complete }
}

/**
 * Newest first, with the key as a total-order tiebreak so two events sharing
 * one `now()` hold a stable order across renders instead of swapping on every
 * sort.
 *
 * **The ride's founding always sorts last on a tie**, for `byNewestThenKey`'s
 * reason on the club: nothing can precede the ride existing, so nothing may be
 * drawn below it — and on the key tiebreak alone `join:` sorts *below*
 * `ride-planned:`, which would put the founding above a rider who joined in the
 * same instant.
 */
function byNewestThenKey(a: RideTimelineEvent, b: RideTimelineEvent): number {
  if (a.kind !== b.kind) {
    if (a.kind === 'ride-planned') return 1
    if (b.kind === 'ride-planned') return -1
  }
  return a.at === b.at ? a.key.localeCompare(b.key) : a.at < b.at ? 1 : -1
}

/**
 * What the screen actually lays out: a postcard is its own card, and a run of
 * consecutive announcements shares one `Grey/10` block with 8px dividers
 * between the rows.
 *
 * `groupClubTimeline`'s shape and its measurement — `Private club - Timeline`
 * (`2043:10604`) draws exactly this, an `Events` frame holding several rows
 * with postcards interleaved between the blocks — reused here because the two
 * screens are meant to read the same. A pure function for the same reason:
 * the run boundaries are the thing a refactor silently gets wrong (one block
 * per event, or one block for the whole stream) and neither misgrouping is
 * visible to any other gate.
 */
export type RideTimelineGroup =
  | { kind: 'postcard'; key: string; event: Extract<RideTimelineEvent, { kind: 'postcard' }> }
  | { kind: 'events'; key: string; events: RideTimelineEvent[] }

export function groupRideTimeline(events: RideTimelineEvent[]): RideTimelineGroup[] {
  const groups: RideTimelineGroup[] = []

  for (const event of events) {
    if (event.kind === 'postcard') {
      groups.push({ kind: 'postcard', key: event.key, event })
      continue
    }

    const last = groups[groups.length - 1]
    // Appended to the open run, or opening a new one. The group's key is its
    // FIRST event's, so a run keeps its identity as later events are added to
    // it rather than remounting the whole block on every refetch.
    if (last?.kind === 'events') last.events.push(event)
    else groups.push({ kind: 'events', key: event.key, events: [event] })
  }

  return groups
}

/**
 * The riders who joined this ride, newest first.
 *
 * **`getRideCrew` cannot serve this and the difference is not a detail**: it
 * orders `joined_at` ASC and caps at `RIDE_CREW_LIMIT`, which is the roster's
 * order — the first to say yes at the top — so on any ride past that cap it
 * returns the earliest joins and the timeline would show nobody who has
 * RSVP'd since. Same table, same policy, opposite end. `getClubJoins` records
 * the identical split one domain over.
 *
 * `joined_at` is server-owned — `048` grants `authenticated` neither INSERT nor
 * UPDATE on it — so a rider cannot backdate or float their own arrival up this
 * list.
 *
 * **A `going` → `maybe` change does not move a rider up the stream, and that is
 * correct rather than a gap.** `joined_at` records arrival, not the current
 * answer; the RSVP itself is the crew rail's business. Nothing in the schema
 * records the change at all — see PD-394, which is where an event log for a
 * ride belongs.
 *
 * A membership this screen cannot name is dropped rather than drawn as a
 * nameless row — the `profiles` policy hides a rider still mid-onboarding, and
 * the entry's whole text is the name.
 */
export async function getRideJoins(
  rideId: string,
  limit = RIDE_TIMELINE_JOINS
): Promise<TimelineSource<RideJoin>> {
  // The guard every ride-scoped read carries: a non-uuid reaches
  // `.eq('ride_id', …)` as `22P02`, PostgREST turns it into a 400 and
  // `unwrapList` throws — which would put a rider on an error boundary offering
  // `Try again` on an address that can never succeed (PD-142). The page has
  // already resolved the ride through `getRide` by the time this runs, so this
  // is defence in depth rather than the gate.
  if (!rideIdSchema.safeParse(rideId).success) return { rows: [], horizon: null }

  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('ride_members')
      // `MEMBER_PROFILE_EMBED` rather than a bare `profiles(...)`: `092` made an
      // unhinted embed answer HTTP 300 the moment a second relationship exists
      // between two tables, and `src/lib/data/__tests__/embed-hints.test.ts`
      // refuses one here.
      .select(`user_id, status, joined_at, ${MEMBER_PROFILE_EMBED}`)
      .order('joined_at', { ascending: false })
      // `user_id` as the tiebreak, for `getClubThreads`' reason: two riders
      // sharing a `now()` would otherwise order in a way Postgres does not
      // promise, so the bound could drop one and repeat the other.
      .order('user_id', { ascending: false })
      .eq('ride_id', rideId)
      .limit(limit),
    "this ride's recent riders",
  ) as unknown as {
    user_id: string
    status: 'going' | 'maybe'
    joined_at: string
    profile: PublicProfile | null
  }[]

  const members = rows.filter((row): row is RideJoin => !!row.profile?.username)
  await resolveAvatarUrls(members.map((member) => member.profile), supabase)

  // The horizon comes from `rows`, before the filter — see
  // `TimelineSource.horizon`. The filter drops rows Postgres already counted
  // against the limit, so one rider with a NULL username in the newest sixty
  // would otherwise make a saturated read look short and report no horizon at
  // all.
  return { rows: members, horizon: boundedHorizon(rows, limit, (row) => row.joined_at) }
}
