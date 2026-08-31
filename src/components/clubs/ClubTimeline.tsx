'use client'

import { ClubTimelineEventRow } from '@/components/clubs/ClubTimelineEventRow'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClubThreadUnread, getClubThreads, CLUB_THREADS_PAGE_SIZE } from '@/lib/data/club-threads'
import {
  CLUB_TIMELINE_JOINS,
  CLUB_TIMELINE_RIDES,
  getClubJoins,
  getClubRideAnnouncements,
  groupClubTimeline,
  mergeClubTimeline,
} from '@/lib/data/club-timeline'
import { FEED_PAGE_SIZE, getClubFeed } from '@/lib/data/postcards'
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
 * same change — they are entries here now, and `ClubActionRow` above carries
 * the entrances they used to own.
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
  const threads = useQuery(isMember ? queryKeys.clubs.threads(clubId) : null, () =>
    getClubThreads(clubId)
  )
  // Shares its key — and so its request — with `ClubActionRow`'s aggregate dot.
  const unread = useQuery(isMember ? queryKeys.clubs.threadsUnread(clubId) : null, () =>
    getClubThreadUnread(clubId)
  )

  /**
   * `All photos` is the club's postcard feed — the same rows this timeline
   * draws, with the pictures at full size.
   *
   * **It is here because the dissolve took its only other entrance.**
   * `ClubPostcardCarousel`'s `See all` was what reached
   * `/postcards?club=<id>`, and nothing else in the app links to it; leaving it
   * unreachable is PD-125's defect — a screen nobody can get to. The timeline
   * is the honest place for it: a lens on the same content rather than a
   * different list, which is what makes `Timeline … All photos` read as a pair
   * rather than as a section header pointing somewhere else.
   *
   * Member-only in effect as well as in placement: `009`'s postcards SELECT
   * policy returns a club's photos to its members, so this link is only ever
   * drawn on the branch that has them.
   */
  const header = (
    <SectionHeader
      title="Timeline"
      action={{ label: 'All photos', href: `/postcards?club=${encodeURIComponent(clubId)}` }}
      className="px-4 py-0"
    />
  )

  if (!isMember) {
    return (
      <section className="flex flex-col gap-2">
        {/* No `All photos` here: `009` returns a non-member none of them, so the
            link would open a blank screen. Its own header rather than the one
            above, for that one difference. */}
        <SectionHeader title="Timeline" className="px-4 py-0" />
        <p className="px-4 text-sm font-medium text-muted">
          Join the club to follow its rides, postcards and threads.
        </p>
      </section>
    )
  }

  // `unread` is deliberately outside the gate: a failed unread call resolves to
  // `{}` inside `getClubThreadUnread`, so it can neither error nor block, and
  // the timeline renders unmarked rather than not rendering.
  const gate = combineQueries(postcards, rides, joins, threads)

  if (gate.error)
    return (
      <section className="flex flex-col gap-2">
        {header}
        <ErrorState onRetry={gate.refetch} />
      </section>
    )

  // Gated on the data, never on `isLoading` — see `combineQueries`. `threads`
  // is compared against `undefined` rather than tested for falsiness, because
  // `getClubThreads` answers `null` for a malformed club id and `!null` would
  // hold this section on its skeleton for ever. That id cannot reach here — the
  // page resolves the club through `getClub` first — which is exactly why the
  // distinction has to be written down rather than discovered.
  if (!postcards.data || !rides.data || !joins.data || threads.data === undefined)
    return (
      <section className="flex flex-col gap-2">
        {header}
        <SkeletonList rows={3} />
      </section>
    )

  const timeline = mergeClubTimeline({
    club: { created_at: club.created_at, owner_id: club.owner_id },
    // `truncated` means *this read came back full, so older rows of this kind
    // exist that we did not fetch* — the input `mergeClubTimeline` cuts the
    // stream on. Compared against each read's own bound rather than a literal,
    // so raising one of them cannot leave a stale number here claiming a full
    // page was a short one.
    rides: { rows: rides.data, truncated: rides.data.length >= CLUB_TIMELINE_RIDES },
    postcards: { rows: postcards.data, truncated: postcards.data.length >= FEED_PAGE_SIZE },
    threads: {
      rows: threads.data ?? [],
      truncated: (threads.data ?? []).length >= CLUB_THREADS_PAGE_SIZE,
    },
    joins: { rows: joins.data, truncated: joins.data.length >= CLUB_TIMELINE_JOINS },
    unread: unread.data ?? {},
  })

  return (
    <section className="flex flex-col gap-2">
      {header}

      {/* 16px between blocks — the frame's `Divider` spine, drawn as the gap
          rather than as a rule: the `Grey/10` event blocks and the white
          postcard cards already separate themselves against the page, and a
          literal 2×16 rectangle between them was the one part of the frame that
          reads as an artefact of how it was assembled. */}
      <div className="flex flex-col gap-4 px-4">
        {groupClubTimeline(timeline.events).map((group) =>
          group.kind === 'postcard' ? (
            // `fill={false}` — the flow mode: a square photo and an unbounded
            // caption. The deck's `fill` divides a fixed height it does not
            // have here, and a photo in a flow context would render at no
            // height at all. See `PostcardCard`.
            <PostcardCard key={group.key} postcard={group.event.postcard} />
          ) : (
            <div key={group.key} className="overflow-hidden rounded-lg bg-track">
              {group.events.map((event, i) => (
                <div key={event.key}>
                  {/* 8px dividers INSIDE a run, matching the frame's
                      `Events` → `Divider` 326×8. Between the rows rather than
                      under each, so a block never ends on a rule. */}
                  {i > 0 && <div className="mx-3 h-px bg-border" />}
                  <ClubTimelineEventRow event={event} />
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* The foot. A complete stream ends on the club's own founding — the
          `club-created` entry above — and needs nothing more; a cut one must
          not pretend to, so it says so and points at the lists that hold the
          rest. Reading the difference off `complete` rather than off a length:
          a stream of exactly twenty entries can be either. */}
      {!timeline.complete && (
        <p className="px-4 pt-1 text-sm font-medium text-muted">
          Older activity lives in{' '}
          <Link
            href={`/postcards?club=${encodeURIComponent(clubId)}`}
            className="font-semibold text-accent"
          >
            photos
          </Link>
          ,{' '}
          <Link href={routes.clubRides(clubId)} className="font-semibold text-accent">
            rides
          </Link>{' '}
          and{' '}
          <Link href={routes.clubThreads(clubId)} className="font-semibold text-accent">
            threads
          </Link>
          .
        </p>
      )}
    </section>
  )
}
