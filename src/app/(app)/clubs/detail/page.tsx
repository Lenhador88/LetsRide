'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { MarkClubSeen } from '@/components/clubs/MarkClubSeen'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { RideCard } from '@/components/rides/RideCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub } from '@/lib/data/clubs'
import { getClubFeed } from '@/lib/data/postcards'
import { getRides } from '@/lib/data/rides'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'

/**
 * How many upcoming rides the timeline strip **shows**. The design draws three
 * in a horizontal scroller; five gives it something to scroll without turning
 * the sub-page into the Rides sub-page, which is one tap away.
 *
 * It bounds the display rather than the read — see the query below for why the
 * two came apart.
 */
const CLUB_TIMELINE_RIDES = 5

/**
 * `Private club - Timeline` (`2043:10604`) — the club's default sub-page.
 *
 * Two of the design's three strands are built. **The third, an activity feed
 * ("Ron Wilson joined the club.", with a time-since), is omitted: there is no
 * table behind it.** Every event it draws — joins, leaves, ride creation — would
 * need either an `events` table written by triggers or a union of derived
 * queries with no shared ordering key. It is a feature, not a component, and
 * rendering a plausible-looking approximation of an audit log is worse than
 * leaving it out. Logged in docs/FIGMA-FIDELITY-TODO.md.
 *
 * **Which club design this is.** The private-club flow is the one marked Done;
 * both public-club flows are On hold, with the note "Public clubs are Post-MVP.
 * Until then we only have private clubs." So this composition is built from the
 * private frames and serves every club, and the public variants' differences —
 * chiefly a join affordance for non-members — are not invented here.
 *
 * ## `null` is the 404; `undefined` is "not yet"
 *
 * `getClub` returns null both for a club that does not exist and for one the
 * policy hides, deliberately indistinguishably — distinguishing them would
 * confirm a private club exists to someone who may not see it (decision #1).
 * Only that null is `notFound()`. `undefined` is the effect not having answered,
 * and calling `notFound()` on it would flash a 404 on every load of every club.
 * The server version had no such distinction: it awaited the read, so there was
 * no state in which the answer had not arrived.
 *
 * All four sub-pages read the club under the same `clubs.detail(id)` key, so
 * switching between them inside the stale window redraws instantly from cache
 * instead of re-asking — which the four server pages, each awaiting its own
 * `getClub`, could not do.
 */
export default function ClubTimelinePage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubTimelineScreen />
    </Suspense>
  )
}

function ClubTimelineScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))

  /**
   * The two content reads wait for the club rather than running alongside it,
   * which is the opposite call from the postcard thread and for a reason that
   * screen does not have. Both of these throw on a malformed uuid — Postgres
   * answers `22P02`, PostgREST turns it into a 400 and `unwrapList` raises —
   * so issued eagerly they would turn `?id=not-a-uuid` into an error screen
   * with a Try again button that can never succeed. The thread screen buys its
   * parallelism with a `postcardIdSchema` parse up front; here the parse lives
   * in `getClub` (`clubIdSchema`, PD-142), which answers `null` and so reaches
   * the `notFound()` below — but the two content reads still have no guard of
   * their own, which is what this gate is.
   *
   * A disabled query is exactly the "must not fetch and must not throw" state
   * `useQuery` documents for a null key, so nothing is issued until `getClub`
   * has come back with a club that exists and is visible.
   */
  const found = !!club.data

  // The club feed under the postcard feed's own key: `getClubFeed(id)` and
  // `getFeed({}, { kind: 'club', id })` are the same select, order, limit and
  // predicate, so `/postcards?club=<id>` and this strand share one entry rather
  // than holding two copies that expire apart.
  const postcards = useQuery(found ? queryKeys.postcards.feed(filterSegment.club(id)) : null, () =>
    getClubFeed(id)
  )

  // The same key and the same read as `/clubs/[id]/rides`, sliced to five for
  // the strip rather than fetched at five. Two different lengths under one key
  // is the failure that avoids: `rides.list('club:<id>')` would hold either the
  // whole list or this strip depending on which screen loaded first, and the
  // other would then draw the wrong number of rides with nothing on screen to
  // say so. Slicing costs the rows between five and `RIDES_PAGE_SIZE` on one
  // request, and makes the Rides sub-page open from cache.
  const rides = useQuery(found ? queryKeys.rides.list(filterSegment.club(id)) : null, () =>
    getRides({ kind: 'club', id })
  )

  // Before the error gate: a club that came back null is a 404 whatever else
  // happened, and the two content queries cannot have failed yet because they
  // were never enabled.
  if (club.data === null) notFound()

  // Above both gates, not inside the loaded branch: back and the sub-page
  // switcher come from the URL, so they work while the club is still arriving
  // and while it has failed. Only the name and the avatar wait.
  const header = <ClubDetailHeader clubId={id} club={club.data} current="timeline" />

  const gate = combineQueries(club, postcards, rides)
  if (gate.error)
    return (
      <>
        {header}
        <ErrorState onRetry={gate.refetch} />
      </>
    )

  // Gated on the data rather than on `isLoading` — see `combineQueries`.
  if (!club.data || !postcards.data || !rides.data)
    return (
      <>
        {header}
        <SkeletonList rows={3} />
      </>
    )

  const upcoming = rides.data.slice(0, CLUB_TIMELINE_RIDES)

  return (
    <>
      {header}
      {club.data.viewer_role && <MarkClubSeen clubId={club.data.id} />}

      <div className="px-4">
        {upcoming.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-medium text-muted">Upcoming rides</h2>
            {/* The design scrolls these horizontally as `Collection / Ride`
                chips. They render as the list card here: one component that is
                already measured beats a second one that is not, and the chip is
                the same three facts in a smaller box. Registered as a fidelity
                gap rather than passed off as the drawn control. */}
            <div className="flex flex-col gap-2">
              {upcoming.map((ride) => (
                <RideCard key={ride.id} ride={ride} showClub={false} />
              ))}
            </div>
          </section>
        )}

        {postcards.data.length === 0 ? (
          <p className="py-8 text-center text-sm font-medium text-muted">
            Nothing has been posted here, yet!
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {postcards.data.map((postcard) => (
              <PostcardCard key={postcard.id} postcard={postcard} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
