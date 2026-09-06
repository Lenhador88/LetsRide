'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { RideTimelineEventRow } from '@/components/rides/RideTimelineEventRow'
import { RideTimelineThreadRow } from '@/components/rides/RideTimelineThreadRow'
import { ErrorState } from '@/components/ui/ErrorState'
import { ScrollSentinel } from '@/components/ui/ScrollSentinel'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getRideJournal } from '@/lib/data/postcards'
import {
  getRideJoins,
  getRideThreadCreations,
  getRideThreadReplies,
  groupRideTimeline,
  mergeRideTimeline,
  RIDE_TIMELINE_LIMIT,
  type RideTimelineSources,
} from '@/lib/data/ride-timeline'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import type { RideDetail } from '@/types'

/**
 * The ride's timeline — what has happened on it, newest first (PD-393).
 *
 * **The ride detail's centre of gravity, as the club detail's has been since
 * PD-355.** The product owner, 2026-09-05: *"Similar to the club list, we need
 * to adopt a timeline… at the top we will keep a sort of header with relevant
 * information about the ride. But then, we will have the timeline with the
 * postcards, announcements (someone joins the ride, etc.). So similar layout
 * and characteristics to the club details."*
 *
 * `RideJournal` — the horizontal strip of stamps this replaces — is deleted in
 * the same change, exactly as `ClubPostcardCarousel` was: a section repeating
 * what the timeline says twenty pixels below it is the length that made the
 * screen confusing in the first place. Its `Add` tile became the `(+)` on this
 * section's own heading — the entrance PD-125 exists to protect — and PD-401
 * then moved that entrance into the sticky bottom slot, where PD-404 turned it
 * into a floating action. **The entrance was never dropped, only relocated**,
 * which is the whole of what PD-125 asks; this heading now carries no control
 * at all. See §The `(+)` is gone below for why it cannot come back here.
 *
 * ## Who sees this — and why there is no membership branch
 *
 * The club's version withholds the whole stream from a non-member, because
 * `081` and `009` return them nothing and a timeline of joins-and-rides alone
 * would read as a real, complete, confidently wrong answer. **A ride has no
 * such split.** `public.ride_journal_postcard_ids` (`062`) gates on
 * `private.can_read_ride` and the postcard qual and says nothing about crew
 * (PD-282), and `102`'s `ride_members` SELECT policy follows ride visibility.
 * So anyone who can open this ride can see every source on it, and since PD-404
 * this component has **no crew-gated element at all** — the create entrance
 * that carried that rule now lives in the page's bottom slot. The rule itself
 * is unchanged and still belongs to the database: tagging a postcard wants
 * `private.is_ride_crew` (`041`), and a control a non-member's insert would
 * refuse is a promise the database breaks.
 *
 * ## Blocking needs no code here
 *
 * Each source's own SELECT policy carries the symmetric `private.is_blocked`
 * conjunct on its author column — the postcard qual restated inside `062`'s
 * accessor, and `102`'s roster policy for the joins. A blocked rider's events
 * never arrive, so there is nothing to filter and no second copy of a block
 * rule here to drift out of step with the first.
 *
 * ## Extending costs no read, because there is nothing below to fetch
 *
 * Both sources are read WHOLE at their own bounds — see `ride-timeline.ts` on
 * why a ride does not borrow the club's paging. So `steps` raises a **display
 * cap** over rows already in hand, and the sentinel is free: no window fetch,
 * no offline state, no failure state past the first read. What the rider
 * reaches at the bottom is either the ride's own founding (the stream is
 * complete) or the honest foot below (a source was cut at its bound).
 */
export function RideTimeline({
  ride,
}: {
  /** The ride itself, for the floor entry — `getRide` has already answered by
   *  the time this renders, so the founding is a prop rather than a third read
   *  of a row the page is holding. */
  ride: Pick<RideDetail, 'id' | 'created_at' | 'organizer_id' | 'organizer'>
}) {
  const rideId = ride.id

  const postcards = useQuery(queryKeys.postcards.journal(rideId), () => getRideJournal(rideId))
  const joins = useQuery(queryKeys.rides.joins(rideId), () => getRideJoins(rideId))
  // `108`, PD-402. Issued unconditionally rather than gated on crew: a non-crew
  // viewer gets zero rows from `108`'s policies, which is the same answer a
  // gate would produce, and gating here would put a second copy of the audience
  // rule in the client. Both keys hang under `rides.detail`, so the create and
  // reply writes reach them by the claims those actions already make.
  const threads = useQuery(queryKeys.rides.threads(rideId), () =>
    getRideThreadCreations(rideId)
  )
  const replies = useQuery(queryKeys.rides.threadReplies(rideId), () =>
    getRideThreadReplies(rideId)
  )

  // The display cap, in `RIDE_TIMELINE_LIMIT`-sized steps. No `windowsFetched`
  // beside it and no ceiling: every step draws rows already fetched, so the
  // only bound that matters is how many exist.
  const [steps, setSteps] = useState(1)

  // Gated on the data, never on `isLoading` — see `combineQueries`. Every read
  // resolves to a `TimelineSource`, so `undefined` is the only "not yet".
  const sources: RideTimelineSources | null =
    postcards.data && joins.data && threads.data && replies.data
      ? {
          ride: {
            created_at: ride.created_at,
            organizer_id: ride.organizer_id,
            // The organizer's name for the floor sentence. `getRide` already
            // embeds the profile, so this needs no read of its own — and
            // `null` (the `profiles` policy hiding a rider mid-onboarding) is
            // handled in the row's copy rather than by dropping the entry.
            organizer: ride.organizer?.username ?? null,
          },
          postcards: postcards.data,
          joins: joins.data,
          threads: threads.data,
          replies: replies.data,
        }
      : null

  const gate = combineQueries(postcards, joins, threads, replies)

  const displayLimit = RIDE_TIMELINE_LIMIT * steps
  const timeline = sources
    ? mergeRideTimeline(sources, displayLimit)
    : { events: [], complete: false }

  /**
   * What the foot is. Three states rather than the club's four, because
   * nothing here can be offline-blocked or fail mid-stream:
   *
   * - `complete` — the founding entry above is already the end of the story.
   * - `draw-more` — the CAP is what cut, and raising it costs no read.
   * - `cut` — a source stopped at its own bound, and the timeline says so
   *   rather than ending as if this were everything.
   */
  const tail: 'complete' | 'draw-more' | 'cut' = !sources
    ? 'complete'
    : timeline.complete
      ? 'complete'
      : timeline.events.length >= displayLimit
        ? 'draw-more'
        : 'cut'

  // The sheet travels WITH the heading rather than being mounted once at the
  // bottom of the component, because `heading` is rendered from three different
  // return branches (error, loading, loaded).
  //
  // ## The `(+)` is gone, and it was unreachable rather than unwanted (PD-404)
  //
  // PD-401 kept it here as the fallback for the one state its create bar could
  // not have: *upcoming + crew + the RSVP bar owns the slot*. PD-404 made
  // answering the RSVP collapse that bar, so the bar is now owed only while the
  // answer is still `null` — and for a non-organizer, `is_crew` IS
  // `attendance !== null` (`src/lib/data/rides.ts:618,692`). The two conditions
  // are contradictory, so the state this covered cannot occur.
  //
  // **Do not add it back "for safety".** A `(+)` on this heading that no input
  // reaches is furniture that reads as a live affordance to whoever edits this
  // screen next, and the only state with no create entrance now is a rider who
  // deliberately reopened the RSVP bar with their own chip — transient, and
  // reversible by the same tap. `bottom-slot.ts` carries the proof and its test
  // pins the identity it rests on.
  const heading = <SectionHeader title="Timeline" className="px-4 py-0" />

  if (gate.error)
    return (
      <section className="flex flex-col gap-2">
        {heading}
        <ErrorState onRetry={gate.refetch} />
      </section>
    )

  if (!sources)
    return (
      <section className="flex flex-col gap-2">
        {heading}
        <SkeletonList rows={3} />
      </section>
    )

  return (
    <section className="flex flex-col gap-2">
      {heading}

      {/* 16px between blocks — the club frame's `Divider` spine, drawn as the
          gap rather than as a rule, for the reason recorded there: the
          `Grey/10` event blocks and the white postcard cards already separate
          themselves against the page. */}
      <div className="flex flex-col gap-4 px-4">
        {groupRideTimeline(timeline.events).map((group) => {
          if (group.kind === 'postcard') {
            // `fill` is left at its default of false — the flow mode: a square
            // photo and an unbounded caption. The deck's `fill` divides a fixed
            // height this has no equivalent of.
            //
            // **No `fromRide` marker**, and the asymmetry is deliberate (`086`,
            // PD-328): every postcard here is from THIS ride by construction,
            // so a badge saying so would be on every card and would say
            // nothing. `RideJournal` made the same call for the same reason.
            //
            // `onRemoved` re-reads both sources rather than only the postcard
            // one: a Hide or a Block acts on the rider as well as the photo, so
            // the joins can move under the same gesture.
            return (
              <div key={group.key} id={group.event.key}>
                <PostcardCard
                  postcard={group.event.postcard}
                  onRemoved={() => {
                    void postcards.refetch()
                    void joins.refetch()
                    // A block hides that rider's threads and replies too —
                    // `108` carries the symmetric block arm on both author
                    // columns — so the conversation sources move under the same
                    // gesture and have to be re-read with the other two.
                    void threads.refetch()
                    void replies.refetch()
                  }}
                />
              </div>
            )
          }

          if (group.kind === 'thread') {
            // A thread's own row rather than a line in the announcement run —
            // `RideTimelineThreadRow` has why. Two event kinds land here and
            // each composes its own lead sentence: the creation names who
            // started it, the reply names who last spoke in it.
            const { event } = group
            return (
              <div key={group.key}>
                {event.kind === 'thread' ? (
                  <RideTimelineThreadRow
                    threadId={event.thread.id}
                    anchorKey={event.key}
                    title={event.thread.title}
                    lead={`${event.thread.author?.username ?? 'A rider'} started this`}
                    at={event.at}
                  />
                ) : (
                  <RideTimelineThreadRow
                    threadId={event.reply.thread_id}
                    anchorKey={event.key}
                    title={event.reply.thread_title}
                    lead={`${event.reply.author ?? 'A rider'} replied`}
                    at={event.at}
                  />
                )}
              </div>
            )
          }

          return (
            <div key={group.key} className="overflow-hidden rounded-lg bg-track">
              {group.events.map((event, i) => (
                <div key={event.key}>
                  {/* 8px dividers INSIDE a run, matching the club frame's
                      `Events` → `Divider` 326×8. Between the rows rather than
                      under each, so a block never ends on a rule. */}
                  {i > 0 && <div className="mx-3 h-px bg-border" />}
                  <RideTimelineEventRow event={event} />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {tail === 'draw-more' && <ScrollSentinel onVisible={() => setSteps((s) => s + 1)} />}

      {/* The one honest foot this screen can offer. **The crew list is the only
          destination**, and not for want of looking: a ride's photos have no
          list of their own — `postcards.feed` filters by rider or club and
          `filterSegment` has no ride arm — so there is nowhere to send someone
          whose journal was the source that cut. Naming a screen that does not
          exist is worse than naming one destination, and building one is
          PD-257's. The crew list can never be empty, because the organizer is
          on it by `103`'s invariant, so this foot always goes somewhere. */}
      {tail === 'cut' && (
        <p className="px-4 pt-1 text-sm font-medium text-muted">
          Showing the most recent activity. The full crew is in{' '}
          <Link href={routes.rideCrew(rideId)} className="font-semibold text-accent">
            riders
          </Link>
          .
        </p>
      )}
    </section>
  )
}
