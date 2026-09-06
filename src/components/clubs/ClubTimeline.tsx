'use client'

import { useEffect, useRef, useState } from 'react'
import { ClubTimelineEventRow } from '@/components/clubs/ClubTimelineEventRow'
import { ClubTimelineRideCard } from '@/components/clubs/ClubTimelineRideCard'
import { ClubTimelineThreadRow } from '@/components/clubs/ClubTimelineThreadRow'
import { MapAttribution } from '@/components/rides/MapAttribution'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { ScrollSentinel } from '@/components/ui/ScrollSentinel'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import {
  resolveClubTimelineAnchorHunt,
  resolveClubTimelineScrollTarget,
} from '@/lib/clubs/club-timeline-anchor'
import { waveJoin, unwaveJoin } from '@/lib/actions/club-waves'
import { getClubThreadUnread, getClubThreads, CLUB_THREADS_PAGE_SIZE } from '@/lib/data/club-threads'
import {
  absorbClubReplyWindow,
  absorbClubTimelineWindow,
  boundedHorizon,
  getClubJoins,
  getClubThreadReplies,
  groupClubTimeline,
  mergeClubTimeline,
  pendingClubTimelineSources,
  resolveClubTimelineAdvance,
  resolveClubTimelineTailState,
  CLUB_TIMELINE_ANCHOR_WINDOWS,
  CLUB_TIMELINE_JOINS,
  CLUB_TIMELINE_LIMIT,
  CLUB_TIMELINE_MAX_WINDOWS,
  CLUB_TIMELINE_REPLIES,
  CLUB_TIMELINE_RIDES,
  type ClubJoin,
  type ClubReplyWindow,
  type TimelineSource,
  type ClubTimelineSources,
  type ClubTimelineWindow,
} from '@/lib/data/club-timeline'
import { attachClubWaveState, resolveClubWaveState } from '@/lib/data/club-waves'
import {
  attachClubIntroductions,
  resolveClubIntroductionState,
} from '@/lib/data/club-introductions'
import { FEED_PAGE_SIZE, getClubFeedWindow } from '@/lib/data/postcards'
import { getCurrentProfile } from '@/lib/data/profile'
import { getClubRideAnnouncements } from '@/lib/data/rides'
import Link from 'next/link'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import type { ClubDetail, ClubThreadListItem, Postcard, RideListItem } from '@/types'

const rideAt = (ride: RideListItem) => ride.created_at
const rideKey = (ride: RideListItem) => ride.id
const postcardAt = (postcard: Postcard) => postcard.created_at
const postcardKey = (postcard: Postcard) => postcard.id
const threadAt = (thread: ClubThreadListItem) => thread.created_at
const threadKey = (thread: ClubThreadListItem) => thread.id
const joinAt = (member: ClubJoin) => member.joined_at
const joinKey = (member: ClubJoin) => member.user_id

/** Folds a list of fetched windows (shallowest first) into one accumulated
 *  source, per `design.md` §D0 — the same fold every one of the four
 *  "rows ARE the window" sources uses; the reply source needs its own
 *  (`absorbClubReplyWindow`) because it also carries `activity`. */
function foldWindows<T>(
  windows: ClubTimelineWindow<T>[],
  at: (row: T) => string,
  id: (row: T) => string
): TimelineSource<T> {
  // The FIRST window seeds the accumulator directly rather than being folded
  // through `absorbClubTimelineWindow` against a `{ rows: [], horizon: null }`
  // placeholder — `absorbClubReplyWindow`'s own fix and its own comment carry
  // the full reasoning: that placeholder's `null` means "reaches the club's
  // beginning" to the absorb rule, so folding a saturated first window into it
  // would let the empty seed win outright, discard the window's real horizon,
  // and poison every later fold too.
  let source: TimelineSource<T> | null = null
  for (const window of windows) {
    source = source ? absorbClubTimelineWindow(source, window, at, id).source : { rows: window.rows, horizon: window.horizon }
  }
  return source ?? { rows: [], horizon: null }
}

/**
 * Watches one source's FIRST window for a refetch that removed a row it used
 * to hold — `design.md` §D4. `onRemoved` discards every deeper window across
 * ALL five sources: the display is one merged stream, so a block or a
 * deletion visible in any source's first window returns the whole screen to
 * its first page, not only that source's.
 *
 * `window` is the source's OWN idea of its first window (already carrying its
 * `until`/`untilInclusive`) — for `joins`/`postcards`/`replies` that is the
 * `useQuery` data itself; for `rides`/`threads`, whose reads return a bare
 * array, the caller wraps it first. `rows` is read separately only so the
 * effect can key off THAT reference without re-deriving the wrapped window
 * (whose own object identity changes every render regardless of whether the
 * underlying data did).
 */
function useFirstWindowRemovalGuard<T>(
  rows: T[] | undefined,
  window: ClubTimelineWindow<T> | undefined,
  at: (row: T) => string,
  id: (row: T) => string,
  onRemoved: () => void
) {
  const previous = useRef<T[] | undefined>(undefined)
  useEffect(() => {
    if (rows === undefined || !window) return
    if (previous.current !== undefined && previous.current !== rows) {
      const { removed } = absorbClubTimelineWindow(
        { rows: previous.current, horizon: null },
        window,
        at,
        id
      )
      if (removed) onRemoved()
    }
    previous.current = rows
    // `rows` alone: `window` is derived from it in the same render and read
    // through this closure, matching `useQuery`'s own `fetcherRef` shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])
}

/**
 * The club's timeline — what has been going on, newest first, now a stream
 * that pages on scroll rather than stopping at twenty (PD-375).
 *
 * **The club detail's centre of gravity since 2026-08-31.** The product owner:
 * *"the current club details seems to become a bit confusing… then the timeline
 * starts, and then we show chronologically what's been going on. For eg. a new
 * discussion created, someone created a postcard, rider joining the club."*
 * The Postcards carousel and the Threads section were dissolved into it in the
 * same change — they are entries here now, and `ClubCreateBar` carries the creates and
 * `ClubThreadsRow` the entrance they used to own.
 *
 * ## The non-member branch is the one rule that is not cosmetic
 *
 * A public club admits every signed-in rider to this screen and `081` admits
 * only its **members** to its threads; `009` says the same of its postcards.
 * A non-member's reads therefore come back with joins and rides in them and
 * nothing else — which would render as a real, well-formed, confidently wrong
 * timeline saying this club talks to nobody and photographs nothing. That is
 * worse than the empty state `ClubThreadsSection` refused to draw, because it
 * has content in it and so reads as complete.
 *
 * So a non-member gets a sentence and no timeline, and the section is **not**
 * hidden outright: a rider deciding whether to join should see that the club
 * has a life they are not being shown. Nothing is fetched for them either — the
 * three member-only reads are disabled rather than filtered, so the refusal
 * costs no round trip and cannot be defeated by reading the response. The
 * sentinel is inside the member branch for the identical reason: a non-member
 * SHALL NOT be able to trigger a page (`club-timeline`'s own requirement).
 *
 * `isMember` is the club's own `viewer_role`, which the detail screen already
 * holds. **It is an affordance and never the enforcement** — a rider who
 * defeats it reads zero rows from RLS anyway.
 *
 * ## Blocking needs no code here
 *
 * Each source's own SELECT policy carries the symmetric `private.is_blocked`
 * conjunct on its author column — `009` for postcards, `081` for threads,
 * `022` for rides, `009` again for the roster. A blocked rider's events never
 * arrive, so there is nothing to filter and, more to the point, no second copy
 * of a block rule here to drift out of step with the first. A deeper window is
 * the same read with a time bound added, so this holds at every depth.
 *
 * ## The paging model, in one sentence
 *
 * Paging lowers each source's horizon rather than advancing five cursors —
 * `design.md` §D0. The first window of each source lives in the shared query
 * cache (`rides`, `postcards`, `threads`, `joins`, `replies` below); deeper
 * windows are session-local (`extra*` state) and are folded together with the
 * first on every render (`foldWindows`/`absorbClubReplyWindow`) to produce the
 * five accumulated sources `mergeClubTimeline` already knew how to read.
 */
export function ClubTimeline({
  club,
  isMember,
}: {
  /** The club itself, for the floor entry — `getClub` has already answered by
   *  the time this renders, so the founding is a prop rather than a sixth read
   *  of a row the page is holding. */
  club: Pick<ClubDetail, 'id' | 'created_at' | 'owner_id'>
  isMember: boolean
}) {
  const clubId = club.id
  const online = useOnlineStatus()

  // The club timeline's own postcard window, since PD-375 (`design.md` §D3) —
  // a child key of the Postcards list's own `feed(filterSegment.club(id))`,
  // because this shape (`ClubTimelineWindow<Postcard>`) is wider than the
  // plain `Postcard[]` that key otherwise holds. The club detail no longer
  // warms the Postcards list's own entry, which is the cost that fix pays.
  const postcards = useQuery(isMember ? queryKeys.postcards.clubWindow(clubId) : null, () =>
    getClubFeedWindow(clubId)
  )
  // Gated on the membership like the other three, and not because these two
  // would fail: `022` returns a public club's rides to any signed-in rider and
  // `009`'s roster policy has a public-club disjunct, so BOTH of these come back
  // populated for a non-member. That is exactly why they are disabled rather
  // than merely unrendered — a read whose result is never shown is a round trip
  // spent to no purpose, and leaving it in place is one refactor away from
  // someone deciding to draw it.
  const rides = useQuery(isMember ? queryKeys.rides.clubAnnouncements(clubId) : null, () =>
    getClubRideAnnouncements(clubId)
  )
  const joins = useQuery(isMember ? queryKeys.clubs.joins(clubId) : null, () => getClubJoins(clubId))
  // The club's live conversation — one entry per recently-active thread, at the
  // instant of its newest message. See `getClubThreadReplies` for why this
  // needs no migration and why the thread's own entry is not simply moved.
  const replies = useQuery(isMember ? queryKeys.clubs.threadReplies(clubId) : null, () =>
    getClubThreadReplies(clubId)
  )
  const threads = useQuery(isMember ? queryKeys.clubs.threads(clubId) : null, () =>
    getClubThreads(clubId)
  )
  // Shares its key — and so its request — with `ClubThreadsRow`'s aggregate dot.
  const unread = useQuery(isMember ? queryKeys.clubs.threadsUnread(clubId) : null, () =>
    getClubThreadUnread(clubId)
  )

  // The signed-in rider's own id — read for exactly one reason: hiding the
  // wave control on a rider's own join row (`ClubTimelineEventRow`'s only use
  // of `viewerId`; the introduction door has no such gate — a rider may read
  // and open their own introduction). Nothing else on this screen needs it,
  // which is why it was not read before `092`.
  const viewer = useQuery(isMember ? queryKeys.profile.me() : null, getCurrentProfile)

  // ---------------------------------------------------------------------
  // Paging state — PD-375. The first window of each source above lives in
  // the shared cache; everything below is session-local and dies with the
  // mount, matching `/clubs/detail/threads`' own trade (`client-cache-
  // invalidation`'s "first page shared, later pages local").
  // ---------------------------------------------------------------------

  const [extraRides, setExtraRides] = useState<ClubTimelineWindow<RideListItem>[]>([])
  const [extraPostcards, setExtraPostcards] = useState<ClubTimelineWindow<Postcard>[]>([])
  const [extraThreads, setExtraThreads] = useState<ClubTimelineWindow<ClubThreadListItem>[]>([])
  const [extraJoins, setExtraJoins] = useState<ClubTimelineWindow<ClubJoin>[]>([])
  const [extraReplies, setExtraReplies] = useState<ClubReplyWindow[]>([])

  // The display cap, in `CLUB_TIMELINE_LIMIT`-sized steps, and how many
  // windows this MOUNT has fetched — the two things `resolveClubTimelineAdvance`
  // and the `CLUB_TIMELINE_MAX_WINDOWS` ceiling need. Reset together with the
  // `extra*` state on a removal, because a rider snapped back to the first
  // page has nothing to show past twenty either.
  const [steps, setSteps] = useState(1)
  const [windowsFetched, setWindowsFetched] = useState(0)
  const [fetching, setFetching] = useState(false)
  const [fetchFailed, setFetchFailed] = useState(false)
  const fetchingRef = useRef(false)

  function resetDeeperWindows() {
    setExtraRides([])
    setExtraPostcards([])
    setExtraThreads([])
    setExtraJoins([])
    setExtraReplies([])
    setWindowsFetched(0)
    setSteps(1)
    setFetchFailed(false)
  }

  // Each source's own first window, wrapped where the read returns a bare
  // array rather than a `ClubTimelineWindow` already (`rides`/`threads`
  // share nothing else and need no shape wider than that, per `design.md`
  // §D3 — only the postcard source's fix required moving it into `lib/data`).
  const firstRideWindow: ClubTimelineWindow<RideListItem> | undefined = rides.data && {
    rows: rides.data,
    horizon: boundedHorizon(rides.data, CLUB_TIMELINE_RIDES, rideAt),
    until: null,
    untilInclusive: true,
  }
  const firstThreadWindow: ClubTimelineWindow<ClubThreadListItem> | undefined = threads.data
    ? {
        rows: threads.data,
        horizon: boundedHorizon(threads.data, CLUB_THREADS_PAGE_SIZE, threadAt),
        until: null,
        untilInclusive: true,
      }
    : undefined

  // Any first-window refetch that dropped a row it used to hold — a block, a
  // hide, a membership ended — discards every deeper window across all five
  // sources (`design.md` §D4). This alone is NOT sufficient on its own; see
  // `PostcardCard`'s `onRemoved` wiring below for the explicit second trigger
  // this signal cannot see (a removal on a row that exists only on a deeper
  // page).
  useFirstWindowRemovalGuard(rides.data, firstRideWindow, rideAt, rideKey, resetDeeperWindows)
  useFirstWindowRemovalGuard(postcards.data?.rows, postcards.data, postcardAt, postcardKey, resetDeeperWindows)
  useFirstWindowRemovalGuard(threads.data ?? undefined, firstThreadWindow, threadAt, threadKey, resetDeeperWindows)
  useFirstWindowRemovalGuard(joins.data?.rows, joins.data, joinAt, joinKey, resetDeeperWindows)
  useFirstWindowRemovalGuard(replies.data?.rows, replies.data, (r) => r.created_at, (r) => r.id, resetDeeperWindows)

  const rideWindows = firstRideWindow ? [firstRideWindow, ...extraRides] : []
  const postcardWindows = postcards.data ? [postcards.data, ...extraPostcards] : []
  const threadWindows = firstThreadWindow ? [firstThreadWindow, ...extraThreads] : []
  const joinWindows = joins.data ? [joins.data, ...extraJoins] : []
  const replyWindows = replies.data ? [replies.data, ...extraReplies] : []

  const accumulatedRides = foldWindows(rideWindows, rideAt, rideKey)
  const accumulatedPostcards = foldWindows(postcardWindows, postcardAt, postcardKey)
  const accumulatedThreads = foldWindows(threadWindows, threadAt, threadKey)
  const accumulatedJoins = foldWindows(joinWindows, joinAt, joinKey)
  const accumulatedReplies = absorbClubReplyWindow(replyWindows)

  /**
   * The wave read — `092`, PD-356. **Not part of `combineQueries` below**, on
   * `unread`'s own precedent just above: a decoration SHALL NOT gate the list
   * it decorates (`client-render-shell`'s Loading/Error rows), so a slow or
   * failed wave read must cost the wave controls and nothing else.
   *
   * **One read rather than two since PD-372.** The thread's creation row
   * carried a wave of its own until the product owner retired it (*"yes, only
   * annoucements are waveable please"*, 2026-09-02), so the join row is the
   * club timeline's only waveable row and `queryKeys.clubs.threadWaves` is
   * gone with `waveThread`/`unwaveThread`.
   *
   * **Gated on the SOURCE read having resolved, not merely on `isMember`.**
   * This cache has no notion of "refetch when an argument changed, only the
   * key" (`useQuery`'s own header): the KEY here is just the club id, so if
   * the query activated before `joins.data` existed it would fetch once
   * against an empty id list and never fetch again for the ids that arrive a
   * render later. Flipping the KEY itself from `null` to real only once the
   * source ids are known — `clubs.preview`'s own pattern above — is what
   * makes the scoping in `attachClubWaveState`'s docstring true rather than a
   * race.
   *
   * **`depth` — PD-375, `design.md` §D5 — is how many JOIN windows beyond the
   * first are held**, so the key changes only when the JOIN id set actually
   * grows, never on a display-cap bump alone. Scoped to the WHOLE accumulated
   * join id set, never the delta — a per-page merge in component state would
   * leave an earlier page's counts stale after exactly the invalidation that
   * exists to refresh them.
   */
  const joinDepth = extraJoins.length || undefined
  const joinWaves = useQuery(
    isMember && joins.data !== undefined ? queryKeys.clubs.joinWaves(clubId, joinDepth) : null,
    () => attachClubWaveState(clubId, accumulatedJoins.rows.map(joinKey))
  )

  /**
   * The join row's door and count — `097`, PD-365, `attachClubWaveState`'s
   * own precedent one row up: scoped to the WHOLE accumulated join id set,
   * gated on that read having resolved rather than merely on `isMember`, and
   * depth-keyed for the identical reason.
   */
  const joinIntroductions = useQuery(
    isMember && joins.data !== undefined ? queryKeys.clubs.joinIntroductions(clubId, joinDepth) : null,
    () => attachClubIntroductions(clubId, accumulatedJoins.rows.map(joinKey))
  )

  // `unread` is deliberately outside the gate: a failed unread call resolves to
  // `{}` inside `getClubThreadUnread`, so it can neither error nor block, and
  // the timeline renders unmarked rather than not rendering. Gated on the
  // FIRST window's five reads only — a deeper window's failure must never
  // blank the stream (`client-render-shell`'s standing rule, restated for a
  // fetch the rider triggered by scrolling rather than by navigating).
  const rowsReady =
    isMember &&
    !!postcards.data &&
    !!rides.data &&
    !!joins.data &&
    !!replies.data &&
    threads.data !== undefined

  const gate = combineQueries(postcards, rides, joins, threads, replies)

  /**
   * The display cap and the merge — recomputed every render from the folded
   * sources above. `resolveClubTimelineAdvance` then decides the tail: raise
   * the cap for free when it is what cut, fetch only when the horizon is.
   */
  const timelineSources: ClubTimelineSources | null = rowsReady
    ? {
        club: { created_at: club.created_at, owner_id: club.owner_id },
        rides: accumulatedRides,
        postcards: accumulatedPostcards,
        threads: accumulatedThreads,
        joins: accumulatedJoins,
        replies: accumulatedReplies,
        activity: accumulatedReplies.activity,
        unread: unread.data ?? {},
      }
    : null

  const displayLimit = CLUB_TIMELINE_LIMIT * steps
  const timeline = timelineSources
    ? mergeClubTimeline(timelineSources, displayLimit)
    : { events: [], complete: false }
  const advance = timelineSources
    ? resolveClubTimelineAdvance(timeline, displayLimit, windowsFetched, CLUB_TIMELINE_MAX_WINDOWS)
    : 'complete'

  /**
   * Issues one window's reads, in parallel, for exactly the sources
   * `pendingClubTimelineSources` names — a source that has gone short is
   * finished and re-asking it would send `until = null`, silently re-reading
   * page one for ever (`design.md` §D0). At most one in flight; a failure
   * costs the tail rather than the stream and is never retried automatically.
   */
  async function fetchNextWindow(): Promise<void> {
    // The ceiling is enforced explicitly here too, rather than resting only on
    // every caller checking `advance !== 'capped'` first — the manual "Try
    // again" retry reaches this directly on a `fetchFailed` state, and a
    // defensive check costs nothing.
    if (fetchingRef.current || !timelineSources || windowsFetched >= CLUB_TIMELINE_MAX_WINDOWS) return
    fetchingRef.current = true
    setFetching(true)
    setFetchFailed(false)

    const pending = pendingClubTimelineSources(timelineSources)

    try {
      const [rideWindow, postcardWindow, threadWindow, joinWindow, replyWindow] = await Promise.all([
        pending.includes('rides') && accumulatedRides.horizon
          ? getClubRideAnnouncements(clubId, CLUB_TIMELINE_RIDES, accumulatedRides.horizon).then(
              (rows): ClubTimelineWindow<RideListItem> => ({
                rows,
                horizon: boundedHorizon(rows, CLUB_TIMELINE_RIDES, rideAt),
                until: accumulatedRides.horizon,
                untilInclusive: true,
              })
            )
          : Promise.resolve(null),
        pending.includes('postcards') && accumulatedPostcards.horizon
          ? getClubFeedWindow(clubId, { before: accumulatedPostcards.horizon, limit: FEED_PAGE_SIZE })
          : Promise.resolve(null),
        pending.includes('threads') && accumulatedThreads.horizon
          ? getClubThreads(clubId, undefined, CLUB_THREADS_PAGE_SIZE, accumulatedThreads.horizon).then(
              (rows): ClubTimelineWindow<ClubThreadListItem> => ({
                rows: rows ?? [],
                horizon: boundedHorizon(rows ?? [], CLUB_THREADS_PAGE_SIZE, threadAt),
                until: accumulatedThreads.horizon,
                untilInclusive: true,
              })
            )
          : Promise.resolve(null),
        pending.includes('joins') && accumulatedJoins.horizon
          ? getClubJoins(clubId, CLUB_TIMELINE_JOINS, accumulatedJoins.horizon)
          : Promise.resolve(null),
        pending.includes('replies') && accumulatedReplies.horizon
          ? getClubThreadReplies(clubId, CLUB_TIMELINE_REPLIES, accumulatedReplies.horizon)
          : Promise.resolve(null),
      ])

      if (rideWindow) setExtraRides((prev) => [...prev, rideWindow])
      if (postcardWindow) setExtraPostcards((prev) => [...prev, postcardWindow])
      if (threadWindow) setExtraThreads((prev) => [...prev, threadWindow])
      if (joinWindow) setExtraJoins((prev) => [...prev, joinWindow])
      if (replyWindow) setExtraReplies((prev) => [...prev, replyWindow])

      setWindowsFetched((n) => n + 1)
      // Raising the cap alongside the fetch is what actually reveals the new
      // rows: `mergeClubTimeline` always slices to `displayLimit`, so a
      // window landing with no cap increase would extend the horizon without
      // drawing anything past what was already on screen.
      setSteps((s) => s + 1)
    } catch {
      setFetchFailed(true)
    } finally {
      fetchingRef.current = false
      setFetching(false)
    }
  }

  /** The sentinel's own handler — one extension gesture. */
  function handleSentinelVisible() {
    if (fetchingRef.current || fetchFailed) return
    if (advance === 'complete' || advance === 'capped') return
    if (advance === 'draw-more') {
      setSteps((s) => s + 1)
      return
    }
    if (!online) return
    void fetchNextWindow()
  }

  // Connectivity returning resumes the stream on its own, without the rider
  // scrolling again — `client-render-shell`'s offline scenario. Not for a
  // genuine FAILURE, which stays a manual retry (`design.md` §D1: an
  // automatic retry there would hammer a failing endpoint).
  //
  // Every branch is deferred a tick — `PostcardDeck`'s own precedent for
  // `react-hooks/set-state-in-effect`, which rejects a `setState` called
  // synchronously as the only thing an effect body does (`fetchNextWindow`
  // itself sets state before its first `await`, so calling it inline counts),
  // for the cascading render it causes.
  useEffect(() => {
    if (!online || fetchFailed || fetchingRef.current) return
    if (advance === 'fetch-window') {
      const timer = window.setTimeout(() => void fetchNextWindow(), 0)
      return () => window.clearTimeout(timer)
    }
    if (advance !== 'draw-more') return
    const timer = window.setTimeout(() => setSteps((s) => s + 1), 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  /**
   * The return anchor — `097`'s follow-up, PD-366, now a HUNT (`design.md`
   * §D6). A rider who tapped a join's introduction, a thread's creation entry
   * or a reply lands back here with that row's own key on the URL as a
   * fragment (`clubThreadReturnTo` is what puts it there); this extends the
   * stream, unasked, until the row exists or the hunt's own budget
   * (`CLUB_TIMELINE_ANCHOR_WINDOWS`) is spent — spent FROM the mount's own
   * `CLUB_TIMELINE_MAX_WINDOWS` ceiling, never added to it.
   *
   * **Two states, not one** — `huntState` ('hunting' → 'settled') answers "is
   * the hunt still running", latched on an OUTCOME (found, complete, or the
   * budget spent); `mayScroll` answers "may the screen still scroll", latched
   * the instant EITHER an actual scroll fires OR the hunt settles for any
   * OTHER reason — not only after a scroll has already happened. Reusing one
   * boolean for both questions — the bug this replaces — ends the hunt on the
   * very first `rowsReady`, before any hunting fetch could run, because every
   * window the hunt itself fetches makes the rows "ready" again.
   *
   * **`mayScroll` is a ref, flipped synchronously inside the effect body
   * itself, not deferred behind the `setHuntState('settled')` timer below.**
   * `huntState` is React state and only takes effect on the NEXT commit; a
   * ref is visible to this very same effect the instant it re-enters, which
   * is what makes reaching settled — for ANY reason, found or given up —
   * permanently foreclose a scroll rather than merely block a SECOND one.
   * `design.md` §D6's "a late refetch does not move a reading rider" is
   * exactly this: once settled, nothing that happens afterwards may call
   * `scrollIntoView`, even a re-entrant effect run that would otherwise
   * recompute `'found'`.
   */
  const [huntState, setHuntState] = useState<'hunting' | 'settled'>('hunting')
  const [huntWindowsSpent, setHuntWindowsSpent] = useState(0)
  const mayScroll = useRef(true)

  // Every `setState` below is deferred a tick — see the connectivity effect
  // above for why: `react-hooks/set-state-in-effect` rejects a synchronous
  // call, and `scrollIntoView` (a side effect on an external system, not
  // React state) is the one call in here that is exempt and stays immediate.
  //
  // `fetching` is a dependency in its own right, not implied by `advance` or
  // `huntWindowsSpent` changing. The `'fetch-window'` branch below bumps
  // `huntWindowsSpent` and starts `fetchNextWindow` in the SAME timer
  // callback; `fetchNextWindow` itself flips `fetchingRef.current`/`fetching`
  // true SYNCHRONOUSLY before its first `await`, so the very next commit
  // re-runs this effect, finds `fetchingRef.current` true and bails — with
  // `huntWindowsSpent` already at its new value. Without `fetching` listed
  // here, the LATER commit where the read actually lands and `fetching`
  // flips back to `false` changes no OTHER listed dependency whenever the
  // source is still cutting (`advance` reads the same `'fetch-window'` both
  // times, `timeline.complete` stays `false`) — so React never re-runs the
  // effect, and the hunt fetches exactly one window and then stalls forever,
  // never checking whether the row it just fetched now exists. Verified by
  // `ClubTimeline.test.tsx`'s "continues the hunt once a deferred read
  // resolves on a LATER tick" case, which forces a real gap between the two
  // commits and fails without `fetching` in this array.
  useEffect(() => {
    if (!rowsReady || huntState !== 'hunting' || fetchingRef.current) return

    const step = resolveClubTimelineAnchorHunt(
      window.location.hash,
      (id) => !!document.getElementById(id),
      timeline.complete,
      huntWindowsSpent,
      CLUB_TIMELINE_ANCHOR_WINDOWS
    )

    if (step === 'found') {
      if (mayScroll.current) {
        mayScroll.current = false
        const target = resolveClubTimelineScrollTarget(window.location.hash, (id) =>
          !!document.getElementById(id)
        )
        if (target) document.getElementById(target)?.scrollIntoView({ block: 'start' })
      }
      const timer = window.setTimeout(() => setHuntState('settled'), 0)
      return () => window.clearTimeout(timer)
    }
    if (step === 'give-up') {
      // Forecloses a scroll immediately, synchronously — see `mayScroll`'s
      // own doc. Nothing found this round, so there is nothing to scroll to
      // regardless, but a later re-entrant run must not get to decide
      // otherwise once the hunt has given up.
      mayScroll.current = false
      const timer = window.setTimeout(() => setHuntState('settled'), 0)
      return () => window.clearTimeout(timer)
    }
    // 'continue' — spend the mount's allowance exactly as an ordinary step
    // would: raise the cap for free when that is what is cutting, or fetch
    // and count it against the hunt's own budget when it is not.
    if (advance === 'draw-more') {
      const timer = window.setTimeout(() => setSteps((s) => s + 1), 0)
      return () => window.clearTimeout(timer)
    }
    if (advance === 'fetch-window') {
      const timer = window.setTimeout(() => {
        setHuntWindowsSpent((n) => n + 1)
        void fetchNextWindow()
      }, 0)
      return () => window.clearTimeout(timer)
    }
    // `advance` is 'complete' or 'capped' here with the row still missing —
    // nothing left to try.
    mayScroll.current = false
    const timer = window.setTimeout(() => setHuntState('settled'), 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsReady, huntState, advance, timeline.complete, huntWindowsSpent, fetching])

  const photosHref = `/postcards?club=${encodeURIComponent(clubId)}`

  /**
   * The heading, with no destination on it until there is one to offer.
   *
   * `All photos` — the club's postcard feed — is here because the dissolve took
   * its only other entrance: `ClubPostcardCarousel`'s `See all` was what
   * reached `/postcards?club=<id>` and nothing else in the app links to it.
   * Leaving it unreachable is PD-125's defect, a screen nobody can get to.
   *
   * **But an entrance to an EMPTY list is the same defect wearing the other
   * face, and this screen has a standing policy against it** — the ride
   * section on the club detail withholds its own `See all` when the sub-page
   * has nothing on it, and the carousel this replaces gated this very link on
   * `postcards.data.length > 0`. Being a member is not the same as having
   * photos: the qualifying condition is the club having posted any, not the
   * rider being allowed to see them if it had.
   */
  const heading = (action?: { label: string; href: string }) => (
    <SectionHeader title="Timeline" action={action} className="px-4 py-0" />
  )

  if (!isMember) {
    return (
      <section className="flex flex-col gap-2">
        {/* No `All photos` here either, for a second reason on top of the one
            above: `009` returns a non-member none of them, so the link would
            open a blank screen whatever the club has posted. */}
        {heading()}
        <p className="px-4 text-sm font-medium text-muted">
          Join the club to follow its rides, postcards and threads.
        </p>
      </section>
    )
  }

  if (gate.error)
    return (
      <section className="flex flex-col gap-2">
        {heading()}
        <ErrorState onRetry={gate.refetch} />
      </section>
    )

  // Gated on the data, never on `isLoading` — see `combineQueries`. `threads`
  // is compared against `undefined` rather than tested for falsiness, because
  // `getClubThreads` answers `null` for a malformed club id and `!null` would
  // hold this section on its skeleton for ever. That id cannot reach here — the
  // page resolves the club through `getClub` first — which is exactly why the
  // distinction has to be written down rather than discovered.
  if (!timelineSources)
    return (
      <section className="flex flex-col gap-2">
        {heading()}
        <SkeletonList rows={3} />
      </section>
    )

  // Gated on the club having posted any, not on the rider being allowed to see
  // them if it had — see `heading`.
  const hasPhotos = accumulatedPostcards.rows.length > 0

  /**
   * The foot's destinations, and every one of them is gated on holding
   * something — except Members, which cannot be empty (the rider reading this
   * is in it) and is what guarantees the foot always has somewhere to go.
   *
   * Members is here because the spec asks for four and the first draft shipped
   * three: `See all postcards · All rides · All threads · All members`. It is
   * also the only one that can be offered unconditionally, which is what stops
   * the gating above from ever producing a foot that says "older activity
   * lives in" and then names nowhere.
   */
  const handoff = [
    hasPhotos && { label: 'photos', href: photosHref },
    accumulatedRides.rows.length > 0 && { label: 'rides', href: routes.clubRides(clubId) },
    accumulatedThreads.rows.length > 0 && { label: 'threads', href: routes.clubThreads(clubId) },
    { label: 'members', href: routes.clubMembers(clubId) },
  ].filter((link): link is { label: string; href: string } => !!link)

  const tailState = resolveClubTimelineTailState(timeline.complete, online, fetchFailed, advance)

  return (
    <section className="flex flex-col gap-2">
      {heading(hasPhotos ? { label: 'All photos', href: photosHref } : undefined)}

      {/* 16px between blocks — the frame's `Divider` spine, drawn as the gap
          rather than as a rule: the `Grey/10` event blocks and the white
          postcard cards already separate themselves against the page, and a
          literal 2×16 rectangle between them was the one part of the frame that
          reads as an artefact of how it was assembled. */}
      <div className="flex flex-col gap-4 px-4">
        {groupClubTimeline(timeline.events).map((group) => {
          if (group.kind === 'postcard') {
            // `fill` is left at its default of false — the flow mode: a square
            // photo and an unbounded caption. The deck's `fill` divides a fixed
            // height it does not have here, and a photo in a flow context would
            // render at no height at all. See `PostcardCard`.
            //
            // No SEPARATE wave here (`092`, PD-356) — `PostcardCard` already
            // carries `LikeButton`, which is the identical `postcard_likes`
            // reaction under the older name (design.md §D1). A second wave
            // target for the same photo would count one thing twice.
            //
            // The wrapping `div` carries the scroll anchor (`097`'s follow-up,
            // PD-366) — `PostcardCard` opens a viewer rather than navigating
            // away, so it has no return link to carry, only a scroll target.
            //
            // `onRemoved` — PD-375, `design.md` §D4's explicit second trigger:
            // the first-window removal guard above can only see the interval
            // the first page covers, so a Hide or Block acting on a postcard
            // that exists only on a deeper page needs the control that KNOWS
            // to say so.
            return (
              <div key={group.key} id={group.event.key}>
                <PostcardCard postcard={group.event.postcard} onRemoved={resetDeeperWindows} />
              </div>
            )
          }

          if (group.kind === 'ride') {
            return (
              <ClubTimelineRideCard
                key={group.key}
                ride={group.event.ride}
                at={group.event.at}
                anchorKey={group.event.key}
              />
            )
          }

          if (group.kind === 'thread') {
            const event = group.event
            return event.kind === 'thread' ? (
              <ClubTimelineThreadRow
                key={group.key}
                threadId={event.thread.id}
                anchorKey={event.key}
                title={event.thread.title}
                // **No fallback byline.** `add-club-timeline`'s spec requires
                // that the timeline never render a sentence naming nobody, and
                // `Started by a rider` is exactly that. A thread whose author
                // the `profiles` policy hides still matters — it has a title,
                // faces and replies — so the row keeps it and drops the clause
                // rather than the entry. That is the thread row's departure
                // from the event row, where the sentence IS the name and the
                // entry is dropped instead.
                lead={
                  event.thread.author?.username
                    ? `Started by ${event.thread.author.username}`
                    : 'New thread'
                }
                at={event.at}
                unread={event.unread}
                activity={event.activity}
                // **No wave on either thread branch since PD-372.** The
                // creation entry carried one under `092`; the product owner
                // made the announcement row the club timeline's only waveable
                // row, so `ClubTimelineThreadRow` no longer takes the prop at
                // all and neither branch can pass one.
              />
            ) : (
              <ClubTimelineThreadRow
                key={group.key}
                threadId={event.reply.thread_id}
                anchorKey={event.key}
                title={event.reply.thread_title}
                lead={event.reply.author ? `${event.reply.author} replied` : 'New message'}
                at={event.at}
                unread={event.unread}
                activity={event.activity}
              />
            )
          }

          return (
            <div key={group.key} className="overflow-hidden rounded-lg bg-track">
              {group.events.map((event, i) => (
                <div key={event.key}>
                  {/* 8px dividers INSIDE a run, matching the frame's
                      `Events` → `Divider` 326×8. Between the rows rather than
                      under each, so a block never ends on a rule. */}
                  {i > 0 && <div className="mx-3 h-px bg-border" />}
                  <ClubTimelineEventRow
                    event={event}
                    viewerId={viewer.data?.id}
                    // Only a `join` entry decorates with a wave — every other
                    // kind reaching this run (`club-created`) ignores the prop.
                    wave={
                      event.kind === 'join'
                        ? {
                            state: resolveClubWaveState(joinWaves.data, event.member.user_id),
                            onWave: () => waveJoin(clubId, event.member.user_id),
                            onUnwave: () => unwaveJoin(clubId, event.member.user_id),
                          }
                        : undefined
                    }
                    // `097`, PD-365 — `undefined` when there is none or the
                    // read has not resolved, both of which the row draws as
                    // "no door" per its own doc.
                    introduction={
                      event.kind === 'join'
                        ? resolveClubIntroductionState(
                            joinIntroductions.data,
                            event.member.user_id
                          )
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* **The credit for the map tiles the ride cards draw, and it is a licence
          obligation rather than a nicety.** Since PD-236 the deployed
          `resolve-ride-location` fetches tiles with `attribution=none`, so the
          burned-in credit is gone and the app owes it in HTML wherever a tile
          renders — CLAUDE.md §Supabase Rules: *"a duplicate credit for the
          length of a deploy is harmless, an absent one is a licence breach."*
          This screen drew no tile until the timeline started rendering
          `RideCard`, which is why it had none.

          Conditional on a tile actually being on screen, matching
          `/rides/explore` and `/clubs/detail/rides`: the credit belongs where
          the imagery is, and a club whose rides have no tiles owes nothing.

          **The re-derive command in docs/FIGMA-FIDELITY-TODO.md cannot see this
          call site**, because neither this file nor the page names
          `map_card_url` — the tile arrives inside a component. That gap is
          logged with the command. */}
      {timeline.events.some((event) => event.kind === 'ride' && !!event.ride.map_card_url) && (
        <MapAttribution className="px-4 pt-1" />
      )}

      {/* The tail — `design.md` §D2's four states, replacing the wall this
          screen used to stop at. `complete` draws nothing further: the
          `club-created` entry above is already the end of the story. */}
      {tailState === 'more-coming' && (
        <>
          <ScrollSentinel onVisible={handleSentinelVisible} />
          {/* Gated on a fetch actually being IN FLIGHT, never on "more could
              exist" — the offline row above is exactly the state where the
              latter would sit on screen for ever (`client-render-shell`'s
              requirement). */}
          {fetching && <SkeletonList rows={3} />}
        </>
      )}

      {tailState === 'offline' && (
        <>
          <p role="status" className="px-4 pt-1 text-sm font-medium text-muted">
            You&rsquo;re offline — more will load once you&rsquo;re back.
          </p>
          {/* Stays mounted so the connectivity effect above has something to
              resume without the rider scrolling again. */}
          <ScrollSentinel onVisible={handleSentinelVisible} />
        </>
      )}

      {/* Every link is gated on its list holding something, which is the same
          policy the heading applies and the ride section on the club detail
          already applied — an entrance to an empty screen is PD-125's defect
          with the sign flipped. `handoff` can never come back empty, because
          Members is ungated and cannot be. */}
      {tailState === 'cannot-get-more' && (
        <div className="flex flex-col gap-2 px-4 pt-1">
          <p className="text-sm font-medium text-muted">
            Older activity lives in{' '}
            {handoff.map((link, i) => (
              <span key={link.href}>
                {i > 0 && (i === handoff.length - 1 ? ' and ' : ', ')}
                <Link href={link.href} className="font-semibold text-accent">
                  {link.label}
                </Link>
              </span>
            ))}
            .
          </p>
          {fetchFailed && (
            <p role="alert" className="text-sm text-danger">
              Could not load more.{' '}
              <button type="button" onClick={() => void fetchNextWindow()} className="font-semibold underline">
                Try again
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  )
}
