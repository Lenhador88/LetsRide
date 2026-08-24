'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { NearbyRidesStrip } from '@/components/rides/NearbyRidesStrip'
import { RideCard } from '@/components/rides/RideCard'
import { RideFilterBar } from '@/components/rides/RideFilterBar'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonFilterBar, SkeletonList } from '@/components/ui/Skeleton'
import { getMyLocationText } from '@/lib/data/profile'
import { getRideFilters, getRides } from '@/lib/data/rides'
import { nearLabel } from '@/lib/location/near-label'
import type { NearLabel } from '@/lib/location/near-label'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { nearbyRides } from '@/lib/rides/nearby'
import { parseRideFilter, parseRideNear } from '@/lib/validation/rides'
import { cn } from '@/lib/utils'
import type { RideFilter, RideListItem } from '@/types'

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
        <Suspense fallback={<RidesLoading />}>
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

  // The near-you toggle, a separate axis from the filter above — see
  // `rideSearchParamsSchema`. It is read from the URL rather than held in state
  // so it survives a back button, a reload and a shared link, and so the strip
  // can be a plain link rather than a control with a handler.
  const near = parseRideNear({ near: searchParams.get('near') ?? undefined })

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

  // The filter bar always describes every upcoming ride, never the filtered
  // slice — otherwise picking a club would erase every other tile and strand
  // you there with no way back. That is why it has its own key with no filter
  // segment, and why changing the filter refetches one of these two, not both.
  const rides = useQuery(queryKeys.rides.list(filterKey), () => getRides(filter))
  const filters = useQuery(queryKeys.rides.filters(), () => getRideFilters())

  // Where the rider is, for the near-you strip (PD-260). Its own query, on the
  // same key `/clubs` and `/clubs/explore` use, so a rider arriving from either
  // pays nothing and — more importantly — measures from the same coordinates.
  // It never prompts: without an already-granted permission it answers with the
  // geocoded profile city, or nothing.
  //
  // **No `null`-key hold here, unlike `/clubs`.** That page gates its explore
  // *query* on the position because the position is part of its cache key; this
  // one is not — the list read below is keyed on the filter alone and the
  // position only decides which of its rows are drawn. So a late position
  // re-renders the strip and refetches nothing.
  const position = useQuery(queryKeys.riderLocation(), resolveRiderLocation)
  // The rider's own city, for the strip's `near …`. Its own read rather than
  // `getCurrentProfile`, which would sign an avatar and a cover to render one
  // word.
  const city = useQuery(queryKeys.profile.location(), getMyLocationText)

  // Only the bar's own read gates the bar — on the error path as much as on
  // the loading one. A failed list read leaves `filters.data` sitting in cache
  // and its own read successful, so collapsing both into one `gate.error` puts
  // the reported symptom back on the very path where it is worst: the control
  // for choosing a different filter is the way out of a failing one.
  const gate = combineQueries(rides, filters)
  if (filters.error) return <ErrorState onRetry={gate.refetch} />

  // Gated on the data, not on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is still nothing to draw.
  if (!filters.data) return <RidesLoading />

  // The name of the place the distances were measured FROM — never the profile
  // city beside a device-measured distance. `nearLabel` owns that rule.
  const label = nearLabel(position.data, city.data)

  // Measured against the upcoming half only. "Rides happening around you" is a
  // thing a rider turns up to; a ride that already happened two towns over is
  // not one, however near it was. That is also why the Past section drops out
  // entirely while the filter is on rather than being filtered too.
  const nearUpcoming = nearbyRides(rides.data?.upcoming, position.data)

  // `undefined` until BOTH inputs are decided, and that is not tidiness: a zero
  // computed while the position is still resolving is indistinguishable from a
  // real "nothing near you", and `NearbyRidesStrip` draws those differently.
  const nearCount =
    position.data === undefined || !rides.data ? undefined : nearUpcoming.length

  // **With the filter on and the position still undecided, the answer is "not
  // yet", not "none".** `nearUpcoming` is `[]` in both states, so handing it
  // straight to the list would flash `No rides near you` on every load and then
  // fill in — the same `null`-vs-`undefined` confusion the detail screens make a
  // 404 out of. `undefined` falls to the skeleton branch below instead.
  const upcoming = near
    ? position.data === undefined
      ? undefined
      : nearUpcoming
    : rides.data?.upcoming

  // The Past section drops out entirely while the filter is on. A ride that has
  // already happened is not a ride happening around you, however near it was.
  const past = near ? [] : rides.data?.past

  // Toggling preserves every other parameter — a rider who filtered to a club
  // and then tapped the strip wants that club's rides near them, not a reset to
  // every ride. `URLSearchParams` rather than string surgery for the same
  // reason `routes.ts` exists.
  const toggled = new URLSearchParams(searchParams.toString())
  if (near) toggled.delete('near')
  else toggled.set('near', '1')
  const toggledQuery = toggled.toString()
  const nearHref = toggledQuery ? `/rides?${toggledQuery}` : '/rides'

  return (
    <>
      <RideFilterBar filters={filters.data} active={filter} />

      {/* Between the bar and the list, and OUTSIDE the list's gate — the strip
          is the only way to turn the filter back off, so a failed or pending
          list read must not take it with them. Its own padded wrapper for
          `ExploreClubsStrip`'s reason: the list is `px-4` and a shared wrapper
          would lay this out 16px narrower. */}
      <div className="px-4 pt-2">
        <NearbyRidesStrip count={nearCount} near={label} active={near} href={nearHref} />
      </div>

      {rides.error ? (
        <ErrorState onRetry={rides.refetch} />
      ) : !rides.data || !upcoming || !past ? (
        // The wrapper, not the skeleton, carries `py-2`: `SkeletonList`'s root
        // is `px-4` only, and it now stands in the same slot as the loaded
        // list rather than replacing the screen — so without it every filter
        // tap ends with the cards jumping 8px as the data lands.
        //
        <div className="py-2">
          <SkeletonList />
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <EmptyList filter={filter} near={near ? (label ?? { name: 'you' }) : null} />
      ) : (
        <div className="motion-safe:animate-fade-in flex flex-col">
          {upcoming.length === 0 ? (
            // A different sentence and a different amount of room: this one
            // sits above the Past rides header rather than owning the
            // screen, so `py-24` would read as the end of the page — and the
            // claim it makes has to be about *upcoming* rides, since there are
            // demonstrably rides underneath it.
            <EmptyList filter={filter} near={near ? (label ?? { name: 'you' }) : null} spacing="section" />
          ) : (
            <RideCards rides={upcoming} filter={filter} />
          )}

          {past.length > 0 && (
            <>
              {/* `px-4` to sit over the cards rather than the component's own
                  `px-6`, the same correction the club detail page makes. */}
              <SectionHeader title="Past rides" className="px-4 pb-0 pt-4" />
              <RideCards rides={past} filter={filter} />
            </>
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
function RidesLoading() {
  return (
    <>
      <SkeletonFilterBar />
      {/* `py-2` on the wrapper, not the skeleton — same reason as the loaded
          branch: `SkeletonList`'s root is `px-4` only. */}
      <div className="py-2">
        <SkeletonList />
      </div>
    </>
  )
}

/** One section of the list. Both sections draw the same card, at the same width. */
function RideCards({ rides, filter }: { rides: RideListItem[]; filter?: RideFilter }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      {rides.map((ride) => (
        <RideCard key={ride.id} ride={ride} showClub={filter?.kind !== 'club'} />
      ))}
    </div>
  )
}

/**
 * Two of these strings are the design's, verbatim. The other two are not drawn
 * — `Home - Rides - Rides from club` has no empty variant, and no frame draws
 * this screen with past rides but none ahead — so both are written to match
 * their shape rather than invented in a different voice.
 *
 * **`spacing` changes the claim, not only the padding, and that is the point.**
 * Alone on the screen the unfiltered message is "There are no rides, yet!",
 * which is true. Above a Past rides section it is flatly contradicted by the
 * list under it, so that one case says *upcoming* instead — the qualification
 * the `mine` and `club` strings already carry, which is why only this branch
 * needed it.
 */
function EmptyList({
  filter,
  near,
  spacing = 'page',
}: {
  filter?: RideFilter
  /**
   * The place the near-you filter is measuring from, when it is on — `null`
   * when it is off. It outranks `filter` in the message because it is the
   * narrower claim and the one the rider just made: told "you have no upcoming
   * rides" while a near filter is silently excluding three of them, a rider
   * concludes the list is broken rather than filtered.
   */
  near?: NearLabel
  spacing?: 'page' | 'section'
}) {
  const message = near
    ? `No rides near ${near.name}, yet!`
    : filter?.kind === 'mine'
      ? 'You have no upcoming rides, yet!'
      : filter?.kind === 'club'
        ? 'This club has no upcoming rides, yet!'
        : spacing === 'page'
          ? 'There are no rides, yet!'
          : 'There are no upcoming rides, yet!'

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
