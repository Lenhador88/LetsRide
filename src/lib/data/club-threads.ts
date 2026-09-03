import { resolveSupabase } from '@/lib/supabase/resolve'
import { decorateChat } from '@/lib/data/chat'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import { clubThreadIdSchema, clubIdSchema } from '@/lib/validation/clubs'
import type {
  ClubChatMessage,
  ClubThreadCursor,
  ClubThreadDetail,
  ClubThreadListItem,
  ClubMessage,
} from '@/types'

/**
 * How many threads one page of the Threads list reads.
 *
 * Bounded and keyset-paged rather than truncated, unlike the ride chat's window:
 * a thread list grows for the life of a club and its oldest rows are still worth
 * reaching, so `(created_at, id)` carries a cursor. 20 fills a 390px screen with
 * room to scroll.
 */
export const CLUB_THREADS_PAGE_SIZE = 20

/**
 * How much of one thread the screen reads — `RIDE_MESSAGES_PAGE_SIZE`'s number
 * and its whole argument, including that this is the **newest** N rather than
 * the oldest. See the two-`order` dance below.
 */
export const CLUB_MESSAGES_PAGE_SIZE = 200

/**
 * The column that says a thread is an **announcement** rather than an ordinary
 * one — `097`'s marker, `club_threads.introduces_user_id` (PD-372).
 *
 * > **An introduction is an announcement while its subject is a member. The
 * > moment the marker goes, the thread is an ordinary thread and is listed as
 * > one.**
 *
 * **This is a PRESENTATION rule, not a visibility one, and the distinction is
 * the whole reason it is written down here.** `081` decides who may read a
 * thread and this decides where a readable one is DRAWN — the announcement is
 * already on the club timeline as the rider's join row, with its own door and
 * its own comment count (`097`, `attachClubIntroductions`), so listing it a
 * second and third time as a thread and as a reply drew one conversation three
 * ways. Nothing here narrows an audience: every row this filter hides is a row
 * the policy already returned and the join row already shows.
 *
 * **Why the marker and not `introduction`.** `097` NULLs the marker when the
 * subject leaves the club and keeps the text and every comment — deliberately,
 * *"leaving a club SHALL detach the introduction and SHALL destroy nothing"*.
 * Filtering on `introduction` would keep those words alive and take away every
 * way of arriving at them: off every list for ever, and unmoderatable in
 * practice, since `094`'s takedown is entered from the thread screen which is
 * entered from the list. `097` already refused that same disappearance one
 * level down, on the thread screen itself (its tasks §7.9: *"gate the render on
 * `introduction !== null` and **never** on `introduces_user_id`"*). So an
 * ex-member's introduction comes BACK to the Threads list, at its original
 * `created_at`, as what it now is: an ordinary thread titled `Introduction`
 * with `Started by ana` beneath it, from `author_id`, which the leave does not
 * touch.
 *
 * **The name is what is shared, not a literal.** The three reads spell three
 * different things — `introduces_user_id` on the base table,
 * `thread.introduces_user_id` through `getClubThreadReplies`' embed, and a
 * `not … is null` rather than an `is null` in `getClubThreadUnread`, which
 * asks the opposite question. What must not drift is the rule and its reason.
 *
 * **The cost this rule used to carry, closed by PD-375.** The announcement
 * row used to be a WINDOW: `CLUB_TIMELINE_LIMIT` was a wall at 20, the club
 * timeline did not paginate, and no destination in its foot drew an
 * introduction door — so a **current** member with twenty newer events above
 * their join had no browse route to their own introduction once this filter
 * took it off the Threads list. `add-club-timeline`'s cancellation of PD-374
 * was made on the strength of this closing: the timeline now pages
 * (`design.md` of `page-the-club-timeline-on-scroll`), so a rider who scrolls
 * far enough always reaches their own join row and its door, at whatever
 * depth. **Not** the welcome club either way, which `097` refuses
 * introductions to outright (`and not c.is_default`), so the
 * highest-frequency-join club in the app cannot produce this state at all.
 *
 * `097` grants `authenticated` SELECT on this column and no INSERT or UPDATE
 * (measured on DEV, 2026-09-02), which is what makes filtering on it safe
 * without a migration: no rider can set or clear their own marker, so no rider
 * can hide a thread and its whole conversation from a club without deleting
 * it. That was a tidiness rule before this change and is load-bearing after
 * it — a later proposal granting the column, or adding an UPDATE policy to
 * `club_threads`, has to answer this.
 */
export const ANNOUNCEMENT_MARKER = 'introduces_user_id'

const THREAD_SELECT = `
  id, club_id, author_id, title, created_at,
  author:profiles!author_id(id, username)
`

/**
 * One page of a club's threads, newest created first.
 *
 * ## What is deliberately NOT here
 *
 * No membership check, no club-visibility predicate, no block filter. `081`'s
 * SELECT policy owns all three — the `clubs` EXISTS, `private.is_club_member`
 * and the symmetric `private.is_blocked` arm on `author_id` — so "which threads
 * may this rider see" is answered by the time rows come back. Restating any of
 * it here would be a second copy of a policy, free to drift, and the copy that
 * drifts is always the one nobody reads.
 *
 * **The audience is narrower than the club's own**, which is the whole point of
 * `081` and the one thing to hold while reading this file: a public club admits
 * every signed-in rider to its *detail screen* and none of them to its threads.
 * So a non-member of a public club gets `[]` here, indistinguishable from a club
 * nobody has posted in — the screens tell those apart with the club's own
 * `viewer_role`, which `getClub` already carries, exactly as the ride chat uses
 * `is_crew`. That is a UX affordance and never the enforcement.
 *
 * `created_at DESC, id DESC` matches `081`'s index and is a total order; a
 * cursor over `created_at` alone would skip or repeat rows exactly at the
 * boundary where two threads share one `now()`.
 *
 * ## Announcements are not listed here — PD-372
 *
 * `.is(ANNOUNCEMENT_MARKER, null)` keeps a club introduction off this list and
 * off the timeline's thread entries, because the join row already draws it.
 * **It belongs in the paragraph above rather than beside it: it is the one
 * predicate in this query that is NOT a copy of a policy**, because it is not
 * an audience rule at all — see `ANNOUNCEMENT_MARKER`. A non-member of a
 * public club reads `[]` from `081` with or without it, and if this line ever
 * looks like what protects them, that reading is wrong and the policy is what
 * to check.
 *
 * **In the query, not after it.** A post-read filter would break the Threads
 * list's "is there more" signal — `lastCount === CLUB_THREADS_PAGE_SIZE`, so a
 * full page holding five announcements would read as the end of the list — and
 * `boundedHorizon`'s stated precondition that a source's rows ARE its window.
 *
 * **`until` is PD-375's timeline paging bound, BESIDE `cursor` rather than
 * instead of it** — `/clubs/detail/threads` keeps paging on the keyset cursor
 * and must not change behaviour; the club timeline is the only caller that
 * ever passes `until`, inclusive per `design.md` §D3.
 */
export async function getClubThreads(
  clubId: string,
  cursor?: ClubThreadCursor,
  limit = CLUB_THREADS_PAGE_SIZE,
  until?: string
): Promise<ClubThreadListItem[] | null> {
  // Same guard, same reason as `getClub`: a non-uuid segment reaches
  // `.eq('club_id', …)` as `22P02`, PostgREST turns it into a 400 and
  // `unwrapList` throws — so a hand-edited URL would land on the error boundary
  // offering "Try again" on an address that can never succeed. `null` routes it
  // through the same `notFound()` a club nobody may see gets.
  if (!clubIdSchema.safeParse(clubId).success) return null

  const supabase = await resolveSupabase()

  let query = supabase
    .from('club_threads')
    .select(THREAD_SELECT)
    .eq('club_id', clubId)
    .is(ANNOUNCEMENT_MARKER, null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    )
  }
  if (until) query = query.lte('created_at', until)

  return unwrapList(await query, "this club's threads") as unknown as ClubThreadListItem[]
}

/**
 * One thread, or `null` for one that does not exist **or** that this rider may
 * not see — deliberately indistinguishable, the same refusal `getClub` makes.
 *
 * The thread screen needs `club_id` from this rather than from the URL: the
 * route names the thread, and the club is what `Back`, the watermark's cache
 * key and the moderation affordance are all built from.
 *
 * **Widened for `097` (PD-365) to carry `introduction` and its author.** A
 * column nothing reads is a column nothing wrote — without this the text a
 * rider posts through `introduceToClub` would be stored and never rendered.
 * `introduces_user_id` is deliberately NOT selected: it is a composite key
 * into `club_members` rather than an embed path, and the render this feeds
 * (`ClubThreadPage`) gates on `introduction` and never on the marker — see
 * `ClubThreadDetail`'s own doc for why. `author` is hinted `author_id`,
 * matching `THREAD_SELECT` above — `club_threads` has no `user_id` column and
 * its relationship to `profiles` is already ambiguous through
 * `club_thread_reads` and `club_thread_waves` (`design.md` §D8).
 */
export async function getClubThread(id: string): Promise<ClubThreadDetail | null> {
  if (!clubThreadIdSchema.safeParse(id).success) return null

  const supabase = await resolveSupabase()

  return unwrap(
    await supabase
      .from('club_threads')
      .select(
        'id, club_id, author_id, title, created_at, introduction, author:profiles!author_id(id, username)'
      )
      // `maybeSingle`, not `single`: RLS answers a thread this rider may not
      // read with zero rows, and `single` turns that into a PostgREST error
      // (`PGRST116`) which `unwrap` would throw — an error screen where the rest
      // of the app renders not-found.
      .eq('id', id)
      .maybeSingle(),
    'this thread'
  ) as ClubThreadDetail | null
}

/**
 * One thread's messages, oldest first, as the screen renders them.
 *
 * `getRideMessages`' shape exactly, including the two-`order` dance: PostgREST
 * applies `limit` after `order`, so reading the *newest* 200 means ordering
 * descending and rendering them means ascending. The reverse happens here rather
 * than in the component because the grouping walks the list in render order.
 *
 * `username` only on the embed — no `avatar_path`, because the design draws no
 * avatar on a bubble and signing one would be a round trip per distinct author
 * on a screen that refetches on every arrival.
 *
 * **A blocked pair both writing in one thread is a designed state, not a gap.**
 * `081` carries no block arm in either WITH CHECK, so both inserts succeed and
 * each rider's SELECT hides the other's row. The screen must not present the
 * resulting one-sided conversation as an error.
 */
export async function getClubThreadMessages(
  threadId: string
): Promise<ClubChatMessage[] | null> {
  if (!clubThreadIdSchema.safeParse(threadId).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const rows = unwrapList(
    await supabase
      .from('club_messages')
      .select(`id, thread_id, author_id, body, created_at, author:profiles!author_id(id, username)`)
      .eq('thread_id', threadId)
      // Both columns, matching `081`'s index. `created_at` alone is not a total
      // order — two messages written in one transaction carry an identical
      // `now()` and the same thread renders differently on two devices.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CLUB_MESSAGES_PAGE_SIZE),
    'this thread'
  ) as unknown as ClubMessage[]

  rows.reverse()

  return decorateChat(rows, user?.id)
}

/**
 * Which of a club's threads hold a message this rider has not read (`081`).
 *
 * One RPC for the whole list, answering `(thread_id, has_unread)`.
 * `club_thread_unread` is `security invoker`, so `081`'s SELECT policies
 * decide what counts and blocks are honoured by the same policy the thread
 * obeys. **No block filter, no membership check and no visibility predicate
 * appear here**, for the reason `getClubThreads` gives at length.
 *
 * A failure resolves to "nothing is unread" rather than throwing, and that is a
 * product decision rather than defensive coding — `getRideChatUnread` rules the
 * same way. The marks decorate a list that works without them, so a failed
 * unread call must cost the decoration and nothing else: the list still renders,
 * unmarked. The reverse is what must never be drawn, and cannot be from here — a
 * mark can only ever appear beside a thread the list itself returned.
 *
 * ## The map answers only for threads the Threads list can show — PD-372
 *
 * The RPC answers for **every** thread in the club, announcements included, and
 * this cannot change it: `club_thread_unread` is a database function and there
 * is no migration here. So the correction is in the read.
 *
 * Two of the three consumers need nothing — `ClubThreadRow` and `ClubTimeline`
 * both index by thread id, and after `getClubThreads`' own filter no
 * announcement produces a row for them to look up. **The third aggregates**:
 * `ClubOptionsMenu`'s `Threads` item is `Object.values(...).some(Boolean)`, and
 * it is now the only aggregate dot in the app. Left alone, an unread comment on
 * an introduction would light a dot that points at the Threads list and
 * **cannot be cleared by visiting it**, because the thread it names is not on
 * it.
 *
 * **Proportional to the UNREAD set, and skipped entirely when nothing is
 * unread.** Only ids the RPC actually marked can light anything, so only those
 * are read back. Two shapes were rejected: intersecting with page 1 of
 * `getClubThreads` under-reports, because threads are listed by creation and an
 * old thread with a new comment sits past page 20 — a false negative traded for
 * a false positive; and reading every announcement in the club is bounded by
 * the membership rather than by the answer — `097` writes one introduction per
 * member, so that read grows with the roster.
 *
 * **This is a REDUCTION, not a bound, and the difference is worth stating
 * because every neighbouring read has a real one** — `CLUB_THREADS_PAGE_SIZE`
 * and `CLUB_MESSAGES_PAGE_SIZE` in this file, `CLUB_TIMELINE_JOINS` and
 * `CLUB_TIMELINE_REPLIES` next door. The unread set is unbounded
 * in principle: `club_thread_unread` (`082`) reads a club's whole thread list
 * with no limit, so a returning member of a very busy club can carry hundreds
 * of ids into the `in()` below, and PostgREST puts them in a GET query string.
 * Past the gateway's request-line cap the read errors, and the failure rule
 * below then resolves the WHOLE map to `{}` — every mark in that club goes,
 * including the legitimate ones, silently. That fails **closed**, which is the
 * right direction, but it fails **totally**, and it fails worst in the club
 * that most needs the marks. The exact threshold is INFERRED rather than
 * measured; what is read off the code is that no cap exists. Capping the list
 * is not the fix on its own — checking only the first N would leave the rest
 * lit unverified, which the rule below forbids outright.
 *
 * A consequence worth naming rather than discovering: an announcement with
 * **nothing** unread keeps its `false` entry, because the corrective read never
 * sees it. No consumer can act on a `false`, so the map's answer is the same
 * either way — but it is a narrowing of what could light, not a purge of the
 * marker from the map.
 *
 * The corrective read obeys the same failure rule as the RPC above: if it
 * errors, the whole map resolves to `{}`. It must never return marks it could
 * not verify.
 */
export async function getClubThreadUnread(clubId: string): Promise<Record<string, boolean>> {
  if (!clubIdSchema.safeParse(clubId).success) return {}

  const supabase = await resolveSupabase()
  const { data, error } = await supabase.rpc('club_thread_unread', { club: clubId })

  if (error || !data) return {}

  const rows = data as { thread_id: string; has_unread: boolean }[]
  const marked = rows.filter((row) => row.has_unread).map((row) => row.thread_id)

  // Nothing is marked, so nothing can light and there is nothing to correct —
  // the `length === 0` early return `attachClubWaveState` and
  // `attachClubIntroductions` both open with, here saving the round trip
  // rather than an empty `in()`.
  if (marked.length === 0) return toUnreadMap(rows)

  const { data: announcements, error: markerError } = await supabase
    .from('club_threads')
    .select('id')
    .in('id', marked)
    .not(ANNOUNCEMENT_MARKER, 'is', null)

  // `!announcements` as well as the error, matching the RPC branch above: the
  // rule is absolute — never return a mark this function could not verify —
  // and a null payload verifies nothing. `postgrest-js` resolves a successful
  // list select to an array, so this arm is unreachable today; it is written
  // because the rule is what a later reader has to be able to trust.
  if (markerError || !announcements) return {}

  const hidden = new Set(announcements.map((row) => row.id))

  return toUnreadMap(rows.filter((row) => !hidden.has(row.thread_id)))
}

function toUnreadMap(rows: { thread_id: string; has_unread: boolean }[]): Record<string, boolean> {
  return Object.fromEntries(rows.map((row) => [row.thread_id, row.has_unread]))
}
