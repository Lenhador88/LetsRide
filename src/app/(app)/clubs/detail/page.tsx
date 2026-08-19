'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { Globe2Icon, LocationOutlineIcon, Lock2Icon } from '@/components/icons/generated'
import { ClubCreateRideRow } from '@/components/clubs/ClubCreateRideRow'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubMembershipButton } from '@/components/clubs/ClubMembershipButton'
import { ClubMemberRail } from '@/components/clubs/ClubMemberRail'
import { ClubPostcardCarousel } from '@/components/clubs/ClubPostcardCarousel'
import { MarkClubSeen } from '@/components/clubs/MarkClubSeen'
import { RideChip } from '@/components/rides/RideChip'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub } from '@/lib/data/clubs'
import { getClubFeed } from '@/lib/data/postcards'
import { getRides } from '@/lib/data/rides'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import { formatRideDateLong } from '@/lib/utils'

/**
 * How many upcoming rides the Upcoming rides strip **shows**. The design draws
 * three in a horizontal scroller; five gives it something to scroll without
 * turning this section into the Rides sub-page, which `See all` is one tap
 * away from.
 *
 * It bounds the display rather than the read — see the query below for why the
 * two came apart.
 */
const CLUB_TIMELINE_RIDES = 5

/**
 * The club — **one screen now, not the head of a set of four** (the club
 * detail merge, 2026-08-18, this domain's counterpart of PD-254).
 *
 * `Private club - Timeline` (`2043:10604`), `- Rides` (`2059:6390`), `- Members`
 * (`2059:6545`) and `- About` (`2059:6700`) are still the frames the pieces of
 * this screen are built from, and they are no longer the whole specification:
 * the drawn sub-page sheet (`Private club - Sub Pages`, `2059:5931`) is
 * deleted, and Members and Upcoming rides are sections on this page with their
 * own `See all` rather than destinations behind a dropdown. That is a
 * deviation from the Figma and it is logged in
 * docs/FIGMA-FIDELITY-TODO.md §Club detail; the approved frames are
 * `AI / Club detail merged / 2026-08-17` — `4176:12575` (member view),
 * `4181:6897` (owner Options open), `4181:6930` (member Options open) and
 * `4181:13068` (members expanded in place).
 *
 * **What the merge deleted, and why each was a cost rather than a tidy-up:**
 *
 * - **`ClubDetailPageMenu`** hid its own options, the same defect PD-254 named
 *   on the ride side. Every destination it listed is a section or a header
 *   control on this screen now, so the header drops to 96px and this screen
 *   stops paying `.pt-header-sub-extra`.
 * - **`/clubs/detail/about`** is deleted outright. Its type line and
 *   created-at condense onto one muted line here; its description becomes
 *   this screen's own `ExpandableText`; its one unambiguous action — leaving —
 *   moves into `ClubOptionsMenu`, which is also where Edit now lives for an
 *   owner. See that header's own docstring for the one row the approved mock
 *   draws that stays deliberately unbuilt (`Delete club`).
 *
 * `/clubs/detail/members` and `/clubs/detail/rides` are **kept** — `See all`
 * on each section still opens the full roster and the full ride list, and
 * `ClubDetailHeader`'s back button now returns to this screen from either
 * rather than to `/clubs`, the same change `RideHeader` made for the ride
 * crew route when its own switcher went.
 *
 * ## `null` is the 404; `undefined` is "not yet"
 *
 * `getClub` returns null both for a club that does not exist and for one the
 * policy hides, deliberately indistinguishably — distinguishing them would
 * confirm a private club exists to someone who may not see it (decision #1).
 * Only that null is `notFound()`. `undefined` is the effect not having
 * answered, and calling `notFound()` on it would flash a 404 on every load of
 * every club.
 */
export default function ClubPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubScreen />
    </Suspense>
  )
}

function ClubScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))

  /**
   * The two content reads wait for the club rather than running alongside it.
   * Both throw on a malformed uuid — Postgres answers `22P02`, PostgREST turns
   * it into a 400 and `unwrapList` raises — so issued eagerly they would turn
   * `?id=not-a-uuid` into an error screen with a Try again button that can
   * never succeed. The parse lives in `getClub` (`clubIdSchema`, PD-142),
   * which answers `null` and so reaches the `notFound()` below — but these two
   * reads have no guard of their own, which is what this gate is.
   *
   * A disabled query is exactly the "must not fetch and must not throw" state
   * `useQuery` documents for a null key, so nothing is issued until `getClub`
   * has come back with a club that exists and is visible.
   */
  const found = !!club.data

  // The club feed under the postcard feed's own key: `getClubFeed(id)` and
  // `getFeed({}, { kind: 'club', id })` are the same select, order, limit and
  // predicate, so `/postcards?club=<id>` and this strand share one entry
  // rather than holding two copies that expire apart.
  const postcards = useQuery(found ? queryKeys.postcards.feed(filterSegment.club(id)) : null, () =>
    getClubFeed(id)
  )

  // The same key and the same read as `/clubs/detail/rides`, sliced to five
  // for the strip rather than fetched at five. Two different lengths under
  // one key is the failure that avoids: `rides.list('club:<id>')` would hold
  // either the whole list or this strip depending on which screen loaded
  // first, and the other would then draw the wrong number of rides with
  // nothing on screen to say so. Slicing costs the rows between five and
  // `RIDES_PAGE_SIZE` on one request, and makes the Rides sub-page open from
  // cache.
  const rides = useQuery(found ? queryKeys.rides.list(filterSegment.club(id)) : null, () =>
    getRides({ kind: 'club', id })
  )

  // Before the error gate: a club that came back null is a 404 whatever else
  // happened, and the two content queries cannot have failed yet because they
  // were never enabled.
  if (club.data === null) notFound()

  // Above both gates, not inside the loaded branch: back and the menu come
  // from the URL and the club read respectively, so they work while the club
  // is still arriving and while it has failed. Only the name and the avatar
  // wait — see `ClubDetailHeader`.
  const header = <ClubDetailHeader clubId={id} club={club.data} current="detail" />

  const gate = combineQueries(club, postcards, rides)
  // No `.pt-header-sub-extra`: the sub-page switcher that made this header the
  // 120px variant is deleted (the club detail merge), so the shell's own 96px
  // is the whole of it and this owns its own 16px gap under that — the same
  // move the ride plan made when its own switcher went (PD-254).
  if (gate.error)
    return (
      <>
        {header}
        <div className="pt-4">
          <ErrorState onRetry={gate.refetch} />
        </div>
      </>
    )

  // Gated on the data rather than on `isLoading` — see `combineQueries`.
  if (!club.data || !postcards.data || !rides.data)
    return (
      <>
        {header}
        <div className="pt-4">
          <SkeletonList rows={3} />
        </div>
      </>
    )

  // The strip is the design's "Upcoming rides" section and stays exactly that:
  // `getRides` now also answers with the club's previous rides, which the club
  // Rides sub-page draws under its own header and this carousel does not.
  const upcoming = rides.data.upcoming.slice(0, CLUB_TIMELINE_RIDES)
  const isMember = !!club.data.viewer_role
  const TypeIcon = club.data.is_public ? Globe2Icon : Lock2Icon

  return (
    <>
      {header}
      {club.data.viewer_role && <MarkClubSeen clubId={club.data.id} />}

      <div className="flex flex-col gap-4 pt-4 motion-safe:animate-fade-in">
        {/* Rendered whether or not there are rides, which the Timeline version
            of this section was not. Hiding it cost nothing while
            `ClubDetailPageMenu` reached `/clubs/detail/rides` from every club;
            now this `See all` is the route's only entrance when there is
            anything for it to open — hiding the section outright on an empty
            list is exactly PD-125's defect, a screen nobody can reach. The
            ride detail makes the same call for its Journal.

            `See all` is dropped when there are no rides: with none, the Rides
            sub-page has nothing on it, so the link would be an entrance to
            nothing. A member sees a create affordance where the chip strip
            would sit instead — gated on `isMember` (`club.data.viewer_role`),
            the same membership `017`'s `rides` INSERT policy actually
            requires (`club_id is null or private.is_club_member(club_id)`).
            A non-member still gets the plain "No rides are planned, yet!"
            line: a control that always fails RLS is worse than no control. */}
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Upcoming rides"
            action={
              // Gated on what the sub-page has, not on what this strip draws.
              // A club whose rides are all behind it has an empty strip and a
              // Rides sub-page full of previous rides, and dropping the link
              // there is PD-125's defect exactly: a screen nobody can reach.
              rides.data.upcoming.length > 0 || rides.data.past.length > 0
                ? { label: 'See all', href: routes.clubRides(id) }
                : undefined
            }
            className="px-4 py-0"
          />
          {upcoming.length === 0 ? (
            isMember ? (
              <ClubCreateRideRow />
            ) : (
              <p className="px-4 text-sm font-medium text-muted">No rides are planned, yet!</p>
            )
          ) : (
            <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {upcoming.map((ride) => (
                <RideChip key={ride.id} ride={ride} />
              ))}
            </div>
          )}
        </section>

        {/* Tiles, not the stacked `PostcardCard` list this section used to
            draw — see `ClubPostcardCarousel` for the trade.

            `See all` drops on an empty strip, the same policy the rides
            section above applies and for the same reason: `getClubFeed` and
            `/postcards?club=<id>` are the same select under the same key (this
            file's own note above `postcards`' `useQuery`), so an empty strip
            means an empty destination — offering a way to it is offering a
            blank screen. The two sections applied opposite policies to that
            identical situation for one commit. */}
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Postcards"
            action={
              postcards.data.length > 0
                ? { label: 'See all', href: `/postcards?club=${encodeURIComponent(id)}` }
                : undefined
            }
            className="px-4 py-0"
          />
          <ClubPostcardCarousel postcards={postcards.data} isMember={isMember} />
        </section>

        {/* Join only — a constructive action stays visible on the page, where
            the destructive one (Leave) is tucked into the header's dots menu.
            An owner is always a member and never sees this either way. Kept
            directly above Members, its original neighbour before the
            reorder — the pairing reads as "join, then see who's already in". */}
        {!isMember && (
          <div className="px-4">
            <ClubMembershipButton clubId={id} />
          </div>
        )}

        {/* `px-4`, not the component's own `px-6`: everything these headers
            sit above — the rail's `mx-4`, the chip strip, the postcard column —
            is inset 16px, and the `See all` links make a right edge that is 8px
            out of line visible in a way a title alone never was. */}
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="Members"
            action={{ label: 'See all', href: routes.clubMembers(id) }}
            className="px-4 py-0"
          />
          <ClubMemberRail clubId={id} />
        </section>

        {/* Grouped with a 4px internal gap, not the section-sized 16px the
            surrounding `gap-4` gives every other pair here — these two read
            as one block (type/created-at, then the prose it introduces), and
            the wider gap made them look like two unrelated sections. Product
            owner, 2026-08-18. */}
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 px-4 text-sm font-medium text-muted">
            <TypeIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {club.data.is_public ? 'Public club' : 'Private club'} · Started{' '}
            {formatRideDateLong(club.data.created_at)}
          </p>

          {/* Its own line rather than a third clause on the one above: that
              line is two facts about the club's shape, and where it rides is a
              different kind of fact — and the one most likely to be long.

              Rendered only when set (PD-259). Absent for every club made before
              `066`, and there is deliberately no "no location yet" placeholder
              beside the description's: a missing optional field is not news,
              and the screen already carries one empty-state sentence. */}
          {club.data.location_name && (
            <p className="flex items-center gap-1.5 px-4 text-sm font-medium text-muted">
              <LocationOutlineIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{club.data.location_name}</span>
            </p>
          )}

          {club.data.description ? (
            <ExpandableText className="px-4">{club.data.description}</ExpandableText>
          ) : (
            <p className="px-4 text-sm font-medium text-muted">
              This club has not written a description, yet!
            </p>
          )}
        </div>
      </div>
    </>
  )
}
