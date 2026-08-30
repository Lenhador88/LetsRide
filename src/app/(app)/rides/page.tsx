'use client'

import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { ExploreRidesStrip } from '@/components/rides/ExploreRidesStrip'
import { MapAttribution } from '@/components/rides/MapAttribution'
import { RideCard } from '@/components/rides/RideCard'
import { RideFilterBar } from '@/components/rides/RideFilterBar'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonFilterBar, SkeletonList } from '@/components/ui/Skeleton'
import { getExploreRides, getRideFilters, getRides, withRideDistance } from '@/lib/data/rides'
import { isNearby } from '@/lib/location/distance'
import { UseMyLocationRow } from '@/components/location/UseMyLocationRow'
import { useNearLabel, useRiderPosition } from '@/lib/location/use-rider-position'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { parseRideFilter } from '@/lib/validation/rides'
import { cn } from '@/lib/utils'
import type { RideFilter, RideListItem } from '@/types'
import type { RiderLocation } from '@/lib/location/rider-location'

/**
 * The rides list — `Home - Rides - All`, `… - Your rides` and `… - Rides from
 * club` in the design, which are one screen under three filters rather than
 * three screens.
 *
 * Unlike `/postcards`, this one scrolls: the design's list frame is 810 tall
 * inside a 492 viewport slot. So it keeps the shell's flow layout and only tops
 * up the bottom padding, because the nav bar on this screen carries the sticky
 * "Create ride" action and is the taller of the design's two variants.
 *
 * Every filter shows upcoming rides first — which is what all four frames draw
 * and what the "You have no upcoming rides, yet!" empty state says — and then,
 * under a "Past rides" header, the rides that are behind us. The four
 * frames draw no such section; the club rides screens do, so the header is
 * their `Section / Header` instance, string included.
 *
 * **The boundary is midnight in `APP_TIME_ZONE`, not the current instant** —
 * `rideDayStartUtc`. A ride that left at 15:00 is still in the upcoming list at
 * 23:00 and moves at midnight, which is the product owner's definition and the
 * only one that does not take a ride off the screen of everyone still on it.
 * `RideCard`'s past variants ("Went") are cut at the same instant, so the pill
 * and the section a card sits in can never disagree.
 *
 * ## This tab is the rider's own world; discovery is `/rides/explore`
 *
 * Product owner, 2026-08-27. The unfiltered tab used to be every ride RLS would
 * return, which meant it listed the rides the rider organises and the rides
 * they had already said yes to — so it duplicated `Your rides` beside it, and
 * the app had no screen for *finding* a ride at all. The default tile is `From
 * clubs` now and the strip below the bar is a door rather than a filter.
 *
 * **`?near=1` went with that.** It was a filter over the rows this screen had
 * already read (PD-260), and its whole justification was the asymmetry it
 * recorded in `NearbyRidesStrip`'s header: *"there is no `/rides/explore`"*.
 * There is one now, near-you belongs to it, and a second near-you control on
 * this tab would filter the rider's own clubs by distance — a question nobody
 * asks about a club they have already joined.
 *
 * ## The split, and why the padding wrapper is out here
 *
 * `useSearchParams()` requires a `<Suspense>` boundary above it — Next refuses
 * to prerender a page that reads it without one — so the filter has to be read
 * one component down from the default export. The header and the nav-bar
 * padding stay outside it: both are the same whether the list has arrived or
 * not, and the padding in particular is what keeps the skeleton clear of the
 * sticky action exactly as the loaded list is.
 *
 * ## Two gates, not one (PD-210)
 *
 * The filter bar and the list are gated **separately**, because only one of
 * them changes when a filter is tapped. The list key carries the filter
 * segment, so a new filter is a cache entry with no data yet; a single
 * `if (!rides.data || !filters.data)` therefore swapped the bar for the
 * skeleton too — the whole screen flashed to pick a filter, and the bar came
 * back with its horizontal scroll reset to the left. The bar's own key has no
 * filter segment, so its data is already there and there is nothing to wait
 * for. Whatever gates a subtree must be what that subtree reads.
 *
 * **The property that made this screen and `/postcards` the only two, stated
 * precisely, because the loose version has counterexamples.** It is not "a
 * control changes a query key in place" — `DeleteClubControl`,
 * `DeleteRideControl` and `EditClubForm` all do that, and all three are fine.
 * It is *gating a subtree wider than the read that was re-keyed*: those three
 * scope the pending state to the text that reads it, and every other re-key in
 * the app comes from a route change, where replacing the screen is correct.
 *
 * ## The fade belongs to this gate, not to PD-210's
 *
 * **The cold-load jump is `RidesLoading`'s job, and no padding class can do it
 * (PD-217)** — a skeleton that draws no bar leaves the rows to fall by the
 * bar's ~104px when `filters.data` lands, so the height has to be *reserved* by
 * a shape standing in for it.
 * **`/postcards` has the same shape and the same defect, half the size**, and
 * this comment said the opposite until PD-218. The card is centred and
 * width-driven, so its *size* never changes — that half was right — but the
 * slot it is centred in loses the bar's 104px when the bar lands, which moves
 * a centred child by half the difference. 52px, in the same direction. Whether
 * a jump shows in full or halved is a property of the *alignment*, not of the
 * skeleton: top-aligned here, centred there.
 *
 * `animate-fade-in` sits on the loaded list only — never on `RideFilterBar`,
 * which PD-210 exists specifically to stop swapping. A background refetch of
 * the same filter does not replay it: `rides.data` stays defined across a
 * revalidation, so this branch's `div` is never unmounted, only its children
 * update. A new filter does replay it, correctly — a new `filterKey` is a
 * cache entry with no data yet, so the screen genuinely returns to the
 * skeleton branch first.
 */
export default function RidesPage() {
  return (
    <>
      <Header title="Rides" secondaryAction={<NotificationsHeaderControl />} />
      {/* The shell reserves the 88px nav bar; this screen's bar is the 152px
          variant, so it owes the sticky action's own height. The number lives
          in globals.css beside the other two, not here. */}
      <div className="pb-navbar-action-extra flex flex-col">
        <Suspense fallback={<RidesLoading strip={<ExploreRidesStrip near={null} />} />}>
          <RidesScreen />
        </Suspense>
      </div>
    </>
  )
}

function RidesScreen() {
  const searchParams = useSearchParams()

  // Parsed, not read: a malformed `?club=` would otherwise reach
  // `.eq('club_id', …)` and 400 the whole tab. See lib/validation/rides.ts.
  // `useSearchParams` answers a missing key with null where the server handed
  // over an absent property, and the schema's `.optional()` means undefined.
  const filter = parseRideFilter({
    filter: searchParams.get('filter') ?? undefined,
    club: searchParams.get('club') ?? undefined,
  })

  // `keys.ts` types the list key's filter segment as `string | null`, so the
  // discriminated union is flattened into one string. The kind stays part of it
  // rather than being dropped to the id: `mine` carries no id at all, and two
  // different filters sharing a cache entry is the kind of bug that only shows
  // up as somebody else's rides.
  const filterKey = filter
    ? filter.kind === 'club'
      ? filterSegment.club(filter.id)
      : filterSegment.mine()
    : null

  // The filter bar always describes the rider's whole set — every upcoming ride
  // in their clubs — never the filtered slice, otherwise picking a club would
  // erase every other tile and strand you there with no way back. That is why
  // it has its own key with no filter segment, and why changing the filter
  // refetches one of these two, not both.
  const rides = useQuery(queryKeys.rides.list(filterKey), () => getRides(filter))
  const filters = useQuery(queryKeys.rides.filters(), () => getRideFilters())

  // Where the rider is, for the strip's `near …` (PD-260) and for the distance
  // clause on every card below it (PD-340). One hook, on the key `/clubs`,
  // `/clubs/explore` and `/rides/explore` share, so a rider arriving from any of
  // them pays nothing and — more importantly — measures from the same
  // coordinates. `useRiderPosition` carries the whole reasoning, including why
  // `settled` is not `!isLoading`.
  const { position: positionValue, settled: positionSettled } = useRiderPosition()
  // The name of the place the distances were measured FROM, and its own hook
  // because it costs a second read — this is the one screen that draws the
  // words. `nearLabel` owns the rule that the name must come from the same
  // source as the number.
  const label = useNearLabel(positionValue)

  // **Held with a `null` key until the position is DECIDED**, `/clubs`'s rule
  // and the same double fetch it avoids: `position.data` is undefined on the
  // first render, so an ungated read would run under `unlocated` and again under
  // a coordinate the moment the position landed.
  //
  // This is the strip's read and it is the same entry `/rides/explore` renders,
  // which is what keeps the row's `near <place>` clause equal to the `Near
  // <place>` section behind it. Nothing on THIS screen draws these rides.
  const explore = useQuery(
    positionSettled ? queryKeys.rides.explore(positionValue) : null,
    () => getExploreRides(positionValue)
  )

  // It carries its own padding, so nothing here adds 8px above an error state.
  const strip = (
    <>
      <ExploreRidesStrip
        near={label}
        nearCount={
          label && explore.data
            ? explore.data.filter((ride) => isNearby(ride.distance_km)).length
            : undefined
        }
      />
      {/* Below the explore strip and in the same slot, because it is the same
          question from the other side: the strip says there are rides near you,
          this says how to get an answer at all. The row only draws when the
          rider has no position, which is exactly when the strip's `near …`
          clause has dropped out. */}
      <UseMyLocationRow position={positionSettled ? positionValue : undefined} />
    </>
  )

  const gate = combineQueries(rides, filters)

  // Only the bar's own read gates the bar — on the error path as much as on
  // the loading one. A failed list read leaves `filters.data` sitting in cache
  // and its own read successful, so collapsing both into one `gate.error` puts
  // the reported symptom back on the very path where it is worst: the control
  // for choosing a different filter is the way out of a failing one.
  //
  // **The strip renders in these branches too, and that placement is load-
  // bearing rather than tidy.** It is the only route to `/rides/explore` — the
  // same rule `ExploreClubsStrip` was corrected into — so a rider whose list is
  // failing to load must still be able to leave for the screen that works.
  if (filters.error)
    return (
      <>
        {strip}
        <ErrorState onRetry={gate.refetch} />
      </>
    )

  // Gated on the data, not on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is still nothing to draw.
  if (!filters.data) return <RidesLoading strip={strip} />

  return (
    <>
      <RideFilterBar filters={filters.data} active={filter} />

      {/* Between the bar and the list, and OUTSIDE the list's gate — see the
          note at the error branch above. */}
      {strip}

      {rides.error ? (
        <ErrorState onRetry={rides.refetch} />
      ) : !rides.data ? (
        // The wrapper, not the skeleton, carries `py-2`: `SkeletonList`'s root
        // is `px-4` only, and it now stands in the same slot as the loaded
        // list rather than replacing the screen — so without it every filter
        // tap ends with the cards jumping 8px as the data lands.
        <div className="py-2">
          <SkeletonList />
        </div>
      ) : rides.data.upcoming.length === 0 && rides.data.past.length === 0 ? (
        <EmptyList filter={filter} />
      ) : (
        <div className="motion-safe:animate-fade-in flex flex-col">
          {rides.data.upcoming.length === 0 ? (
            // A different sentence and a different amount of room: this one
            // sits above the Past rides header rather than owning the
            // screen, so `py-24` would read as the end of the page — and the
            // claim it makes has to be about *upcoming* rides, since there are
            // demonstrably rides underneath it.
            <EmptyList filter={filter} spacing="section" />
          ) : (
            <RideCards rides={rides.data.upcoming} filter={filter} near={positionValue} />
          )}

          {rides.data.past.length > 0 && (
            <>
              {/* `px-4` to sit over the cards rather than the component's own
                  `px-6`, the same correction the club detail page makes. */}
              <SectionHeader title="Past rides" className="px-4 pb-0 pt-4" />
              <RideCards rides={rides.data.past} filter={filter} near={positionValue} />
            </>
          )}

          {/* **One credit for every tile on this screen** — PD-236, and see
              `MapAttribution`'s header for why it is not on the cards. An 80px
              strip cannot carry the string without covering the map, which is
              the defect this issue exists to fix.

              **Keyed on any card HAVING a tile, not on one currently drawing.**
              `RideCard` drops its own tile on an `onError` and falls back to the
              pin, so keying this on what succeeded would take the credit away
              exactly when a signature expires — and the obligation is owed while
              the vendor's imagery is on the screen, not while a particular
              `<img>` is healthy. `RideMap` makes the same distinction for the
              same reason.

              Absent entirely when nothing has a tile, which is the ordinary
              state of a fresh database: a screen showing no map data owes no
              map credit, and a line crediting imagery nobody can see is noise
              rather than compliance. */}
          {[...rides.data.upcoming, ...rides.data.past].some((ride) => !!ride.map_card_url) && (
            <MapAttribution />
          )}
        </div>
      )}
    </>
  )
}

/**
 * The screen before either read has landed, and it must be the *loaded* shape
 * with the content taken out — that is the whole fix for PD-217.
 *
 * Both cold-load positions render this one component — the `<Suspense>`
 * fallback, which stands in while `useSearchParams` resolves, and the
 * `!filters.data` gate below it — so the bar's 104px and the list wrapper's
 * 8px are reserved at both, rather than each appearing at a different boundary
 * and moving every row down twice on the way to a settled screen.
 */
function RidesLoading({ strip }: { strip?: ReactNode } = {}) {
  return (
    <>
      <SkeletonFilterBar />
      {/* In the same slot it occupies on the loaded screen, **at both cold-load
          positions**, and that is PD-217 rather than symmetry.
          `NearbyRidesStrip` drew nothing at an undecided count, so the
          `<Suspense>` fallback could omit it and still match the gate below.
          `ExploreRidesStrip` always renders — it is the only door to
          `/rides/explore` — so an omitted strip here injects its ~64px the
          tick the boundary resolves and moves every skeleton row down.

          The fallback passes `near={null}`: there is no position read in
          flight yet, and `null` is exactly what the loaded strip draws while
          the position is undecided, so the two are the same 64px saying the
          same thing rather than a placeholder guessing at one. */}
      {strip}
      {/* `py-2` on the wrapper, not the skeleton — same reason as the loaded
          branch: `SkeletonList`'s root is `px-4` only. */}
      <div className="py-2">
        <SkeletonList />
      </div>
    </>
  )
}

/**
 * One section of the list. Both sections draw the same card, at the same width.
 *
 * **The distance is attached here rather than fetched with the rows** (PD-340).
 * `getRides` is keyed on the filter alone; re-keying it on the rider's position
 * would refetch the whole list the moment a GPS fix landed, which is the double
 * fetch `/clubs` documents and the reason `RideListItem` carries `latitude` and
 * `longitude` at all. Measuring on the row we already hold costs one `Math` call
 * per card and no round trip.
 *
 * `near` null — no position — leaves `distance_km` undefined on every row, and
 * `RideCard` then draws no distance clause. That is the state of every card
 * today for a rider who has never granted location and set no profile city.
 */
function RideCards({
  rides,
  filter,
  near,
}: {
  rides: RideListItem[]
  filter?: RideFilter
  near: RiderLocation | null
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      {rides.map((ride) => (
        <RideCard
          key={ride.id}
          ride={withRideDistance(ride, near)}
          showClub={filter?.kind !== 'club'}
        />
      ))}
    </div>
  )
}

/**
 * Two of these strings are the design's, verbatim. The others are not drawn —
 * `Home - Rides - Rides from club` has no empty variant, and no frame draws
 * this screen with past rides but none ahead — so they are written to match
 * their shape rather than invented in a different voice.
 *
 * **The unfiltered string names the clubs, because the unfiltered tab is the
 * clubs.** It said "There are no rides, yet!" while the tab was every ride in
 * the app, and that sentence is now false in the ordinary case: a rider in one
 * quiet club sees it while thirty public rides sit one tap away on
 * `/rides/explore`. Telling them there are no rides, with a door to rides
 * directly above the sentence, is the contradiction this rewording removes.
 *
 * **`spacing` changes the claim, not only the padding, and that is the point.**
 * Above a Past rides section the message is flatly contradicted by the list
 * under it, so that case says *upcoming* — the qualification the `mine` and
 * `club` strings already carry.
 */
function EmptyList({
  filter,
  spacing = 'page',
}: {
  filter?: RideFilter
  spacing?: 'page' | 'section'
}) {
  const message =
    filter?.kind === 'mine'
      ? 'You have no upcoming rides, yet!'
      : filter?.kind === 'club'
        ? 'This club has no upcoming rides, yet!'
        : spacing === 'page'
          ? 'No rides from your clubs, yet!'
          : 'No upcoming rides from your clubs, yet!'

  return (
    <p
      className={cn(
        'motion-safe:animate-fade-in px-4 text-center text-sm font-medium text-muted',
        spacing === 'page' ? 'py-24' : 'py-8'
      )}
    >
      {message}
    </p>
  )
}
