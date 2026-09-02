'use client'

import { useEffect, useRef } from 'react'
import { ClubTimelineEventRow } from '@/components/clubs/ClubTimelineEventRow'
import { ClubTimelineRideCard } from '@/components/clubs/ClubTimelineRideCard'
import { ClubTimelineThreadRow } from '@/components/clubs/ClubTimelineThreadRow'
import { MapAttribution } from '@/components/rides/MapAttribution'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { resolveClubTimelineScrollTarget } from '@/lib/clubs/club-timeline-anchor'
import { waveJoin, unwaveJoin } from '@/lib/actions/club-waves'
import { getClubThreadUnread, getClubThreads, CLUB_THREADS_PAGE_SIZE } from '@/lib/data/club-threads'
import {
  CLUB_TIMELINE_RIDES,
  boundedHorizon,
  getClubJoins,
  getClubThreadReplies,
  groupClubTimeline,
  mergeClubTimeline,
} from '@/lib/data/club-timeline'
import { attachClubWaveState, resolveClubWaveState } from '@/lib/data/club-waves'
import {
  attachClubIntroductions,
  resolveClubIntroductionState,
} from '@/lib/data/club-introductions'
import { FEED_PAGE_SIZE, getClubFeed } from '@/lib/data/postcards'
import { getCurrentProfile } from '@/lib/data/profile'
import { getClubRideAnnouncements } from '@/lib/data/rides'
import Link from 'next/link'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import type { ClubDetail } from '@/types'

/**
 * The club's timeline — what has been going on, newest first.
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
 * costs no round trip and cannot be defeated by reading the response.
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
 * of a block rule here to drift out of step with the first.
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

  // The same key and the same read as the Postcards list one tap away, so the
  // two cannot disagree: `getClubFeed(id)` and `getFeed({}, {kind:'club',id})`
  // have been one function since `086`.
  const postcards = useQuery(isMember ? queryKeys.postcards.feed(filterSegment.club(clubId)) : null, () =>
    getClubFeed(clubId)
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
   * Scoped to the SOURCE read's own ids (`joins.data`), before the merge's
   * horizon/limit cut — `club-timeline-engagement`'s "the subject ids the
   * timeline's own sources are already holding". That read is already bounded
   * (`CLUB_TIMELINE_JOINS`), so this can never be an unbounded read of the
   * wave table, and decorating a few ids the merge later cuts is harmless
   * overfetch, not a second horizon.
   */
  const joinWaves = useQuery(
    isMember && joins.data !== undefined ? queryKeys.clubs.joinWaves(clubId) : null,
    () =>
      attachClubWaveState(
        clubId,
        // `getClubJoins` returns a `ClubTimelineSource<ClubJoin>` — `{ rows,
        // horizon }` — not a bare array; the ids are in `.rows`.
        (joins.data?.rows ?? []).map((member) => member.user_id)
      )
  )

  /**
   * The join row's door and count — `097`, PD-365, `attachClubWaveState`'s
   * own precedent one row up: scoped to `joins.data`'s own ids, gated on that
   * read having resolved rather than merely on `isMember`, for the identical
   * reason the wave reads are.
   */
  const joinIntroductions = useQuery(
    isMember && joins.data !== undefined ? queryKeys.clubs.joinIntroductions(clubId) : null,
    () =>
      attachClubIntroductions(
        clubId,
        (joins.data?.rows ?? []).map((member) => member.user_id)
      )
  )

  /**
   * The return anchor — `097`'s follow-up, PD-366 (`design.md` §D9). A rider
   * who tapped a join's introduction, a thread's creation entry or a reply
   * lands back here with that row's own key on the URL as a fragment
   * (`clubThreadReturnTo` is what puts it there); this is the one place that
   * can act on it, because the row carrying that `id` exists only once the
   * same five reads the skeleton gate below waits on have resolved.
   *
   * **After the rows exist, and ONLY once.** Not on mount — a client-rendered
   * screen has nothing for a native fragment to find at first paint, so a
   * plain `useEffect(() => {...}, [])` would silently do nothing. Not on every
   * render either — an arriving realtime row or an invalidated cache must
   * never yank a rider who has already started reading, which is why
   * `scrolledToAnchor` rather than `rowsReady` alone decides "once": the two
   * are different questions, and `rowsReady` can go true → true again across
   * an unrelated refetch.
   *
   * `rowsReady` mirrors the skeleton gate below exactly — `unread` and the two
   * wave/introduction decorations are deliberately excluded, for the same
   * reason they are excluded from IT: a decoration must not gate the rows it
   * decorates.
   *
   * **An anchor naming no row is a no-op.** Deleted, past the horizon, or a
   * row the viewer can no longer read are indistinguishable here and all
   * three are ordinary — `resolveClubTimelineScrollTarget` is what makes that
   * testable at all, since `renderToStaticMarkup` runs no effect for anything
   * in this file to assert against directly.
   */
  const rowsReady =
    isMember &&
    !!postcards.data &&
    !!rides.data &&
    !!joins.data &&
    !!replies.data &&
    threads.data !== undefined

  const scrolledToAnchor = useRef(false)
  useEffect(() => {
    if (!rowsReady || scrolledToAnchor.current) return
    scrolledToAnchor.current = true

    const target = resolveClubTimelineScrollTarget(window.location.hash, (id) =>
      !!document.getElementById(id)
    )
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'start' })
  }, [rowsReady])

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

  // `unread` is deliberately outside the gate: a failed unread call resolves to
  // `{}` inside `getClubThreadUnread`, so it can neither error nor block, and
  // the timeline renders unmarked rather than not rendering.
  const gate = combineQueries(postcards, rides, joins, threads, replies)

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
  if (!postcards.data || !rides.data || !joins.data || !replies.data || threads.data === undefined)
    return (
      <section className="flex flex-col gap-2">
        {heading()}
        <SkeletonList rows={3} />
      </section>
    )

  const timeline = mergeClubTimeline({
    club: { created_at: club.created_at, owner_id: club.owner_id },
    // These three ARE their window, so the horizon is the oldest row a full
    // read returned — see `boundedHorizon`. Compared against each read's own
    // bound rather than a literal, so raising one cannot leave a stale number
    // here calling a full page a short one.
    rides: {
      rows: rides.data,
      horizon: boundedHorizon(rides.data, CLUB_TIMELINE_RIDES, (ride) => ride.created_at),
    },
    postcards: {
      rows: postcards.data,
      horizon: boundedHorizon(postcards.data, FEED_PAGE_SIZE, (card) => card.created_at),
    },
    threads: {
      rows: threads.data ?? [],
      horizon: boundedHorizon(
        threads.data ?? [],
        CLUB_THREADS_PAGE_SIZE,
        (thread) => thread.created_at
      ),
    },
    // These two declare their own: both post-process their window, so only they
    // know how far back they looked.
    joins: joins.data,
    replies: replies.data,
    // Who is in each thread and how big it is, off the same window the reply
    // events came from — one read, two answers.
    activity: replies.data.activity,
    unread: unread.data ?? {},
  })

  // Gated on the club having posted any, not on the rider being allowed to see
  // them if it had — see `heading`.
  const hasPhotos = postcards.data.length > 0

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
    rides.data.length > 0 && { label: 'rides', href: routes.clubRides(clubId) },
    (threads.data ?? []).length > 0 && { label: 'threads', href: routes.clubThreads(clubId) },
    { label: 'members', href: routes.clubMembers(clubId) },
  ].filter((link): link is { label: string; href: string } => !!link)

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
            return (
              <div key={group.key} id={group.event.key}>
                <PostcardCard postcard={group.event.postcard} />
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

      {/* The foot. A complete stream ends on the club's own founding — the
          `club-created` entry above — and needs nothing more; a cut one must
          not pretend to, so it says so and points at the lists that hold the
          rest. Reading the difference off `complete` rather than off a length:
          a stream of exactly twenty entries can be either.

          Every link is gated on its list holding something, which is the same
          policy the heading applies and the ride section on the club detail
          already applied — an entrance to an empty screen is PD-125's defect
          with the sign flipped. `handoff` can never come back empty, because
          Members is ungated and cannot be. */}
      {!timeline.complete && (
        <p className="px-4 pt-1 text-sm font-medium text-muted">
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
      )}
    </section>
  )
}
