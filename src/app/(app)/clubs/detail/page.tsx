'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { Globe2Icon, LocationOutlineIcon, Lock2Icon } from '@/components/icons/generated'
import { ClubCreateRideRow } from '@/components/clubs/ClubCreateRideRow'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubJoinRequestsSection } from '@/components/clubs/ClubJoinRequestsSection'
import { ClubPreviewScreen } from '@/components/clubs/ClubPreviewScreen'
import { ClubThreadsSection } from '@/components/clubs/ClubThreadsSection'
import { ClubMembershipButton } from '@/components/clubs/ClubMembershipButton'
import { ClubMemberRail } from '@/components/clubs/ClubMemberRail'
import { ClubPostcardCarousel } from '@/components/clubs/ClubPostcardCarousel'
import { clubTimelineRides } from '@/components/clubs/clubTimeline'
import { MarkClubSeen } from '@/components/clubs/MarkClubSeen'
import { RideChip } from '@/components/rides/RideChip'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub, getClubPreview } from '@/lib/data/clubs'
import { getClubFeed } from '@/lib/data/postcards'
import { getRides, withRideDistance } from '@/lib/data/rides'
import { useRiderPosition } from '@/lib/location/use-rider-position'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import { formatRideDateLong } from '@/lib/utils'

/**
 * The club — **one screen now, not the head of a set of four** (the club
 * detail merge, 2026-08-18, this domain's counterpart of PD-254).
 *
 * `Private club - Timeline` (`2043:10604`), `- Rides` (`2059:6390`), `- Members`
 * (`2059:6545`) and `- About` (`2059:6700`) are still the frames the pieces of
 * this screen are built from, and they are no longer the whole specification:
 * the drawn sub-page sheet (`Private club - Sub Pages`, `2059:5931`) is
 * deleted, and Members and Club rides are sections on this page with their
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

  // For the ride strip's `· 12 km` (PD-340). Up here with the other hooks
  // rather than beside the `timeline` it feeds, because everything below the
  // gates is past a `notFound()` that throws during render. It reads on the key
  // every distance in the app shares and gates nothing: the strip renders
  // whether or not a position ever lands.
  const { position } = useRiderPosition()

  /**
   * **The reduced branch — `085`, PD-325.** A non-member of a private club can
   * now find it in Explore, and `ClubCard` wraps its whole row in a stretched
   * link, so without this every one of those taps landed on a 404.
   *
   * **Enabled only once `getClub` has DECIDED it saw nothing.** `null` versus
   * `undefined` is load-bearing twice on this line: issued eagerly it would
   * cost every club detail in the app a second round trip, and the
   * `notFound()` below needs BOTH reads to be `null` rather than merely falsy
   * or every load would flash a 404 while the first was still out.
   *
   * **`getClub` is unchanged and still conflates "no such club" with "a club
   * the policy hides"** — decision #1's requirement. The PAGE now
   * distinguishes them, using a second, deliberately narrow read; a club that
   * genuinely does not exist still 404s, because the accessor returns nothing
   * for it either.
   */
  const preview = useQuery(club.data === null ? queryKeys.clubs.preview(id) : null, () =>
    getClubPreview(id)
  )

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

  // The club feed under the postcard feed's own key. `getClubFeed(id)` and
  // `getFeed({}, { kind: 'club', id })` return the same rows because since
  // `086` the second DELEGATES to the first — they are one function, not two
  // that happen to agree. That delegation is what keeps this shared entry
  // honest: before it, widening only one of them would have put two different
  // lists under one key and made this strip and its own `See all` disagree by
  // however many ride postcards exist, with the winner decided by which the
  // rider opened first.
  const postcards = useQuery(found ? queryKeys.postcards.feed(filterSegment.club(id)) : null, () =>
    getClubFeed(id)
  )

  // The same key and the same read as `/clubs/detail/rides`, bounded to five
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

  // Before the error gate: a club neither read can see is a 404 whatever else
  // happened, and the two content queries cannot have failed yet because they
  // were never enabled.
  //
  // BOTH must be `null`, never merely falsy: `undefined` is "not yet" and
  // `preview` is `undefined` for the whole of every ordinary club's load.
  if (club.data === null && preview.data === null) notFound()

  // The reduced screen. It issues no query that could return zero rows, which
  // is the property that keeps "permission denied" and "empty" distinguishable
  // here — see `ClubPreviewScreen`. `viewer_role` and `isMember` are untouched
  // by this branch and never computed in it, so every gate below still means
  // exactly what it meant before `085`.
  if (club.data === null && preview.data) return <ClubPreviewScreen club={preview.data} />

  // Above both gates, not inside the loaded branch: back and the menu come
  // from the URL and the club read respectively, so they work while the club
  // is still arriving and while it has failed. Only the name and the avatar
  // wait — see `ClubDetailHeader`.
  //
  // `?? undefined` since `085`: `club.data === null` no longer falls straight
  // to `notFound()` — it may be waiting on the preview read — and `undefined`
  // is what makes the header draw its placeholder title rather than claiming a
  // name it does not have.
  const header = <ClubDetailHeader clubId={id} club={club.data ?? undefined} current="detail" />

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

  // The strip is the design's "Upcoming rides" section widened into the club's
  // whole ride history (PD-319) — upcoming first, then past, in one scroller,
  // with `RideChip` inverting its fill for the past half. `getRides` has
  // answered with both halves since the club Rides sub-page needed them; this
  // strip used to throw the second one away.
  //
  // The split is stated rather than sliced off the concatenation — see
  // `clubTimelineRides`, which is a pure function so the four cases that rule
  // has can be asserted.
  // `withRideDistance` at the render boundary rather than in `getRides`, the
  // same call `/rides` and the club's Rides sub-page make: the read is keyed on
  // the club, and re-keying it on the rider's position would refetch the strip
  // when a fix lands.
  const timeline = clubTimelineRides(rides.data.upcoming, rides.data.past).map((ride) =>
    withRideDistance(ride, position)
  )
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
            title="Club rides"
            action={
              // Still gated on what the sub-page has rather than on what this
              // strip draws, and the two only stopped being able to disagree
              // with PD-319: before it, a club whose rides were all behind it
              // had an empty strip over a sub-page full of past rides, and
              // dropping the link there was PD-125's defect exactly — a screen
              // nobody can reach. Kept in the sub-page's own terms because that
              // is what the link opens, and because the strip's bound means it
              // can still show fewer rides than the sub-page holds.
              rides.data.upcoming.length > 0 || rides.data.past.length > 0
                ? { label: 'See all', href: routes.clubRides(id) }
                : undefined
            }
            create={
              // PD-342: with a strip to scroll, the 148px create chip becomes
              // the `(+)` up here. Still `isMember`, exactly as the chip was —
              // `017`'s rides INSERT policy needs the membership, and a control
              // that always fails RLS is worse than no control.
              isMember && timeline.length > 0
                ? { label: 'Plan a ride', href: routes.newRideInClub(id) }
                : undefined
            }
            className="px-4 py-0"
          />
          {/* Empty means the club has NEVER ridden, not "nothing is planned"
              (PD-319) — the strip carries the past half now, so the sentence
              that used to be true of an empty strip is only true of a club with
              no rides at all. `timeline.length` rather than the two arrays,
              because it is the thing actually drawn. */}
          {timeline.length === 0 ? (
            isMember ? (
              <ClubCreateRideRow clubId={id} />
            ) : (
              <p className="px-4 text-sm font-medium text-muted">
                This club has not ridden, yet!
              </p>
            )
          ) : (
            /* No create chip in the strip any more (PD-342) — it is the `(+)`
               in the heading above. That closes PD-312's objection outright
               rather than paying it down: the tile no longer costs the strip
               any width at all, so the next ride is the first thing under the
               header, and PD-318's requirement that the affordance be visible
               without scrolling is met by the heading instead. */
            <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {timeline.map((ride) => (
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
            create={
              // PD-342. The strip's own `Add` tile stays for the empty state —
              // `ClubPostcardCarousel` draws it on exactly the complement of
              // this condition, and the two must not drift apart or a club with
              // photos gets two ways in and a club with none gets neither.
              isMember && postcards.data.length > 0
                ? { label: 'Add a postcard', href: routes.newPostcardInClub(id) }
                : undefined
            }
            className="px-4 py-0"
          />
          <ClubPostcardCarousel postcards={postcards.data} isMember={isMember} clubId={id} />
        </section>

        {/* Join only — a constructive action stays visible on the page, where
            the destructive one (Leave) is tucked into the header's dots menu.
            An owner is always a member and never sees this either way. Kept at
            this height rather than following Members down the page: what sits
            under it is "Join the club to read and start threads", which
            names what joining buys, and a rider deciding whether to join has to
            meet the button without scrolling. */}
        {!isMember && (
          <div className="px-4">
            <ClubMembershipButton clubId={id} />
          </div>
        )}

        {/* `085`, PD-325 — above Members because a pending request IS a
            roster decision, and because an owner opening the club should meet
            it before the list it changes. Draws nothing for anyone but an
            owner or admin, and nothing when there is nothing pending.
            **PD-326's `Manage riders` absorbs this section**; it should reuse
            the same key and the same read rather than build a second list. */}
        <ClubJoinRequestsSection clubId={id} club={club.data} />

        {/* Above Members: a roster is looked up, a thread is read, so the
            part of a club that changes daily goes first. A non-member of a
            public club gets a join prompt here and no content at all — see
            `ClubThreadsSection`. */}
        <ClubThreadsSection clubId={id} isMember={isMember} />

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
            {/* `null` is the zone: a club's founding date is not a ride's
                departure, so there is no meeting point whose clock it should
                follow — it renders in `APP_TIME_ZONE` like every non-ride stamp
                (`080`, PD-193). */}
            {formatRideDateLong(club.data.created_at, null)}
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
