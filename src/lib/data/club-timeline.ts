import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { resolveAvatarUrls } from '@/lib/data/media'
import { unwrapList } from '@/lib/data/unwrap'
import { resolveSupabase } from '@/lib/supabase/resolve'
import { clubIdSchema } from '@/lib/validation/clubs'
import type { ClubRosterMember, ClubThreadListItem, Postcard, PublicProfile } from '@/types'

/**
 * A ride as the timeline draws it — the announcement, not the ride.
 *
 * **Five columns rather than `RideListItem`, and the narrowness is the point.**
 * A timeline entry says *a ride was planned, and it leaves on this day*; it
 * draws no organizer, no crew avatars, no map tile and no RSVP. Reusing
 * `RideListItem` would mean embedding two profile joins and a `ride_members`
 * fan-out per row to render a title and a date, and — the reason that matters
 * rather than being merely wasteful — it would mean widening the shared
 * `RIDE_SELECT` with a `created_at` that every other ride surface in the app
 * pays for and none of them reads.
 *
 * `created_at` is server-owned: `045` revoked INSERT and UPDATE on it, so an
 * organizer cannot backdate a ride onto the timeline or float an old one to the
 * top of it.
 */
export type ClubRideAnnouncement = {
  id: string
  title: string
  departure_at: string
  created_at: string
  /** `080`'s zone for the meeting point, NULL when the ride carries none. Every
   *  `formatRide*` call on this row takes it — see `rideZone`. */
  timezone: string | null
  /** The name in the event's sentence. Null when the `profiles` policy hides
   *  the row — the entry still draws, with the actor dropped from the sentence
   *  rather than the ride dropped from the club's history. */
  organizer: Pick<PublicProfile, 'id' | 'username'> | null
}

/**
 * A join, with a rider this screen can actually name.
 *
 * **Both halves of the narrowing are load-bearing and neither is redundant.**
 * `ClubRosterMember.profile` is null when the `profiles` SELECT policy hides
 * the row, and `PublicProfile.username` is null in its own right for a rider
 * who has not finished onboarding step 1 — the trigger creates the profile the
 * instant the auth user exists. `getClubJoins` drops both, because an entry
 * reading "someone joined the club" is not an event, it is a shrug, and
 * `${null} joined the club` renders the word "null" with nothing red anywhere.
 *
 * It is what lets the row render a name and a face with no impossible branch to
 * write and never exercise.
 */
export type ClubJoin = Omit<ClubRosterMember, 'profile'> & {
  profile: PublicProfile & { username: string }
}

/**
 * How many entries the club timeline draws.
 *
 * A bound rather than a page, and there is deliberately no `load more`: the
 * timeline is a merge of four independently-bounded reads, so paging it would
 * mean four cursors advancing at four different rates — see `mergeClubTimeline`
 * for why the tail of such a merge is incoherent. Twenty is enough to say what
 * a club has been doing; the full lists are one tap away from the sections and
 * the action row above it.
 */
export const CLUB_TIMELINE_LIMIT = 20

/**
 * How many joins the timeline reads.
 *
 * Larger than `CLUB_TIMELINE_LIMIT` on purpose: joins are the highest-frequency
 * event a club has — the welcome club takes one per signup — so a bound equal to
 * the display limit would put the horizon (below) at "the twentieth most recent
 * join", which on a busy club is this afternoon, and every ride, postcard and
 * thread older than that would be dropped from a timeline with room for them.
 */
export const CLUB_TIMELINE_JOINS = 60

/**
 * How many ride announcements the timeline reads.
 *
 * **This is a read of its own rather than a slice of `getRides`, and the reason
 * is the horizon rather than the columns.** `getRides` bounds its two halves by
 * `departure_at` — the soonest thirty ahead, the latest twenty behind — so the
 * rides it withholds can have been created at *any* moment, including this
 * morning. That makes "the oldest `created_at` we were handed" meaningless as a
 * horizon: the missing ride could be newer than every ride in the answer, and
 * `mergeClubTimeline` would cut at a date that guarantees nothing. Ordering the
 * timeline's own read by the field the timeline sorts on is what makes the rule
 * sound for this source as it is for the other three.
 */
export const CLUB_TIMELINE_RIDES = 30

/**
 * One thing that happened in a club.
 *
 * A discriminated union carrying the domain object rather than a flattened
 * `{ icon, sentence, href }`, for the reason every other row type here is
 * shaped that way: the copy and the destination are the component's business,
 * and a data module that decided them would have to be edited for a wording
 * change.
 *
 * **`at` is when the thing HAPPENED, which for a ride is not when it departs.**
 * `rides.created_at`, never `departure_at` — see `ClubRideAnnouncement`.
 */
export type ClubTimelineEvent =
  | { kind: 'ride'; at: string; key: string; ride: ClubRideAnnouncement }
  | { kind: 'postcard'; at: string; key: string; postcard: Postcard }
  | { kind: 'thread'; at: string; key: string; thread: ClubThreadListItem; unread: boolean }
  | { kind: 'join'; at: string; key: string; member: ClubJoin }
  /**
   * The club itself — `clubs.created_at`, the oldest thing that can be on this
   * stream and therefore its floor.
   *
   * **Appended only when the stream is COMPLETE**, which is what `complete`
   * below answers. On a cut stream it would sit directly under an event from
   * last Tuesday and assert that nothing happened in between — a false
   * adjacency, and a worse lie than the missing rows themselves, because it
   * reads as the end of the story.
   *
   * `founder` is null when the club's owner is not in the roster read or the
   * `profiles` policy hides them; the frame's sentence loses its subject rather
   * than the entry disappearing.
   */
  | { kind: 'club-created'; at: string; key: string; founder: string | null }

/**
 * What each source contributed, and whether it was cut short.
 *
 * `truncated` is the load-bearing half. It means *this read came back full, so
 * older rows of this kind exist that we did not fetch* — which is what
 * `mergeClubTimeline` needs to know to avoid drawing a timeline that silently
 * omits one kind of event below a certain date.
 */
export type ClubTimelineSource<T> = { rows: T[]; truncated: boolean }

/**
 * What the screen draws, and whether it is the whole story.
 *
 * `complete` false means the merge dropped something — at the horizon, at the
 * limit, or both — and the screen owes the rider a way on to the full lists
 * rather than an ending. It is never inferred from `events.length`: a stream of
 * exactly twenty entries can be complete or cut, and those two need different
 * feet.
 */
export type ClubTimeline = { events: ClubTimelineEvent[]; complete: boolean }

export type ClubTimelineSources = {
  /** The club's own founding, for the floor entry. */
  club: { created_at: string; owner_id: string }
  rides: ClubTimelineSource<ClubRideAnnouncement>
  postcards: ClubTimelineSource<Postcard>
  threads: ClubTimelineSource<ClubThreadListItem>
  joins: ClubTimelineSource<ClubJoin>
  /** `thread id -> has unread`, from `getClubThreadUnread`. A missing id is
   *  read (`false`), which is what makes a failed unread call render the
   *  timeline unmarked rather than not render it. */
  unread: Record<string, boolean>
}

/**
 * The merge. Four RLS-filtered lists in, one chronological list out.
 *
 * ## Why this is a client-side merge and not one SQL union
 *
 * A `security definer` RPC unioning the four tables would bypass RLS in its own
 * body, so every audience rule — club membership, the private-club reach, the
 * symmetric block predicate on four different author columns — would have to be
 * restated by hand inside it, and a restated policy is a second copy free to
 * drift. Four ordinary reads keep every row filtered by the policy that owns
 * it. The cost is this function; the alternative's cost is a visibility bug
 * nobody can see in a diff.
 *
 * ## The horizon — the part that is easy to get silently wrong
 *
 * Each source is bounded independently, so a naive `concat().sort().slice()`
 * produces a tail that is not merely short but **wrong**: a club that takes
 * sixty joins a week has its join read full at, say, last Tuesday, and every
 * ride and postcard older than last Tuesday then appears in a timeline that
 * shows no joins beside them — a reader cannot tell "nobody joined" from "we
 * stopped looking". The same list is a plausible, well-ordered, confidently
 * wrong answer, which is exactly the class of defect `tsc` and `next build`
 * cannot see.
 *
 * So: a source that came back **full** may have older rows we never fetched,
 * and its oldest returned row is the point past which our picture of it stops.
 * The timeline is complete only above the **latest** such point, and it is cut
 * there. A source that came back short is complete to the beginning of time and
 * contributes no horizon; a full source that returned nothing cannot exist.
 *
 * The result is a timeline that is shorter than it could be and never lies
 * about what is missing from it.
 *
 * Ordering is `at` descending with the key as the tiebreak, so two events
 * sharing one `now()` — a ride and the notification-shaped rows written in its
 * transaction — hold a stable order across renders instead of swapping on
 * every sort.
 */
export function mergeClubTimeline(
  sources: ClubTimelineSources,
  limit = CLUB_TIMELINE_LIMIT
): ClubTimeline {
  const events: ClubTimelineEvent[] = [
    ...sources.rides.rows.map(
      (ride): ClubTimelineEvent => ({
        kind: 'ride',
        at: ride.created_at,
        key: `ride:${ride.id}`,
        ride,
      })
    ),
    ...sources.postcards.rows.map(
      (postcard): ClubTimelineEvent => ({
        kind: 'postcard',
        at: postcard.created_at,
        key: `postcard:${postcard.id}`,
        postcard,
      })
    ),
    ...sources.threads.rows.map(
      (thread): ClubTimelineEvent => ({
        kind: 'thread',
        at: thread.created_at,
        key: `thread:${thread.id}`,
        thread,
        unread: sources.unread[thread.id] ?? false,
      })
    ),
    ...sources.joins.rows.map(
      (member): ClubTimelineEvent => ({
        kind: 'join',
        at: member.joined_at,
        key: `join:${member.user_id}`,
        member,
      })
    ),
  ]

  const horizons = [
    horizonOf(sources.rides, (ride) => ride.created_at),
    horizonOf(sources.postcards, (postcard) => postcard.created_at),
    horizonOf(sources.threads, (thread) => thread.created_at),
    horizonOf(sources.joins, (member) => member.joined_at),
  ].filter((at): at is string => at !== null)

  // Lexicographic on ISO-8601 rather than parsed: both are UTC strings from
  // Postgres, and `Math.max` over dates would turn an unparseable stamp into
  // `NaN`, which compares false against everything and would silently drop the
  // horizon rather than fail.
  const horizon = horizons.length > 0 ? horizons.reduce((a, b) => (a > b ? a : b)) : null

  const inside = events.filter((event) => horizon === null || event.at >= horizon)
  const ordered = inside.sort(byNewestThenKey)
  const shown = ordered.slice(0, limit)

  // Complete means nothing was dropped at either end: the horizon cut nothing
  // AND the limit cut nothing. Only then does the club's own founding sit
  // legitimately under the oldest entry — see `club-created`.
  const complete = inside.length === events.length && shown.length === ordered.length

  if (complete) {
    shown.push({
      kind: 'club-created',
      at: sources.club.created_at,
      key: `club-created:${sources.club.owner_id}`,
      // The founder's name comes from the roster read rather than from a
      // profile embed on the club, which `getClub` does not carry. A club
      // whose owner holds no `club_members` row — legal since `054`, which
      // lets an owner reach their club without one — has no name to use here,
      // and neither does one whose owner the `profiles` policy hides.
      founder:
        sources.joins.rows.find((member) => member.user_id === sources.club.owner_id)?.profile
          .username ?? null,
    })
    // Re-sorted rather than appended blind: the floor is the oldest thing that
    // can exist, but a `joined_at` default and a `clubs.created_at` written in
    // the same statement can share an instant, and the tiebreak has to decide
    // that pair the same way it decides every other.
    shown.sort(byNewestThenKey)
  }

  return { events: shown, complete }
}

/**
 * Newest first, with the key as a total-order tiebreak so two events sharing one
 * `now()` hold a stable order across renders instead of swapping on every sort.
 *
 * **The club's founding always sorts last on a tie**, and that is not
 * cosmetic: `001` inserts the club and its owner's `club_members` row in one
 * statement pair, so `clubs.created_at` and the owner's `joined_at` routinely
 * share an instant to the microsecond — and on the key tiebreak alone
 * `club-created:` sorts *above* `join:`, putting "Pedro created the club."
 * above "Pedro joined the club." at the very foot of the stream. Nothing can
 * precede the club existing, so nothing may be drawn below it.
 */
function byNewestThenKey(a: ClubTimelineEvent, b: ClubTimelineEvent): number {
  if (a.kind !== b.kind) {
    if (a.kind === 'club-created') return 1
    if (b.kind === 'club-created') return -1
  }
  return a.at === b.at ? a.key.localeCompare(b.key) : a.at < b.at ? 1 : -1
}

/** The oldest row a full read returned, or `null` for a read that was not cut
 *  short and so hides nothing behind it. */
function horizonOf<T>(source: ClubTimelineSource<T>, at: (row: T) => string): string | null {
  if (!source.truncated || source.rows.length === 0) return null
  return source.rows.reduce<string>((oldest, row) => (at(row) < oldest ? at(row) : oldest), at(source.rows[0]))
}

/**
 * The club's most recent joins, for the timeline.
 *
 * **`getClubMembers` cannot serve this and the difference is not a detail**: it
 * orders `joined_at` ASC and caps at `CLUB_ROSTER_LIMIT`, which is the roster's
 * order — oldest first, the founding members at the top — so on any club past
 * that cap it returns the 200 *earliest* joins and the timeline would show
 * nobody who has joined since. Same table, same policy, opposite end.
 *
 * `joined_at` is server-owned — `048` grants `authenticated` neither INSERT nor
 * UPDATE on it — so a rider cannot backdate or float their own arrival up this
 * list.
 *
 * A membership this screen cannot name is dropped rather than drawn as a
 * nameless row — the same rule `getClubMembers` applies to a hidden profile,
 * widened by one field here because the entry's whole text is the rider's name.
 * See `ClubJoin` for the two independent reasons a name can be missing.
 */
export async function getClubJoins(
  clubId: string,
  limit = CLUB_TIMELINE_JOINS
): Promise<ClubJoin[]> {
  // The guard every club read carries: a non-uuid reaches `.eq('club_id', …)`
  // as `22P02`, PostgREST turns it into a 400 and `unwrapList` throws, which
  // would put a rider on an error boundary offering `Try again` on an address
  // that can never succeed (PD-142). `[]` here rather than `null`, because the
  // page has already resolved the club through `getClub` by the time this runs.
  if (!clubIdSchema.safeParse(clubId).success) return []

  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('club_members')
      .select(`user_id, role, joined_at, profile:profiles(${PUBLIC_PROFILE_COLUMNS})`)
      .eq('club_id', clubId)
      .order('joined_at', { ascending: false })
      .limit(limit),
    "this club's recent riders",
  ) as unknown as ClubRosterMember[]

  const members = rows.filter((member): member is ClubJoin => !!member.profile?.username)
  await resolveAvatarUrls(members.map((member) => member.profile), supabase)
  return members
}

/**
 * The rides this club has announced, newest announcement first.
 *
 * **Not `getRides({ kind: 'club', id })`**, which answers a different question:
 * that read splits on `departure_at` for the strip at the top of the club
 * screen — what is coming, and what the club has already ridden — and bounds
 * each half in that order. This one asks when each ride was *planned*. See
 * `CLUB_TIMELINE_RIDES` for why reusing the other read would leave the merge
 * cutting at a date that proves nothing.
 *
 * No audience predicate and no club-visibility check: `022`'s `rides` SELECT
 * policy owns both, so a private club's rides come back for its members and for
 * nobody else. Restating it here would be a second copy of a policy, free to
 * drift.
 */
export async function getClubRideAnnouncements(
  clubId: string,
  limit = CLUB_TIMELINE_RIDES
): Promise<ClubRideAnnouncement[]> {
  if (!clubIdSchema.safeParse(clubId).success) return []

  const supabase = await resolveSupabase()

  return unwrapList(
    await supabase
      .from('rides')
      .select(
        'id, title, departure_at, created_at, timezone, organizer:profiles!organizer_id(id, username)'
      )
      .eq('club_id', clubId)
      // `id` as the tiebreak for the reason `getClubThreads` carries one: two
      // rides sharing a `now()` would otherwise page in an order Postgres does
      // not promise, so the bound could drop one and repeat the other.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
    "this club's rides",
  ) as unknown as ClubRideAnnouncement[]
}

/**
 * What the frame actually lays out: a postcard is its own card, and a **run of
 * consecutive events shares one `Grey/10` block** with 8px dividers between the
 * rows, blocks separated by the 16px `Divider` spine.
 *
 * `Private club - Timeline` (`2043:10604`) draws exactly this — an `Events`
 * frame holding three rows, a postcard, another `Events` frame holding one —
 * so the grouping is measured rather than a styling choice, and it is a pure
 * function for the reason `clubRailSummary` is: the run boundaries are the
 * thing a refactor silently gets wrong (one block per event, or one block for
 * the whole stream) and neither misgrouping is visible to any other gate.
 */
export type ClubTimelineGroup =
  | { kind: 'postcard'; key: string; event: Extract<ClubTimelineEvent, { kind: 'postcard' }> }
  | { kind: 'events'; key: string; events: ClubTimelineEvent[] }

export function groupClubTimeline(events: ClubTimelineEvent[]): ClubTimelineGroup[] {
  const groups: ClubTimelineGroup[] = []

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
