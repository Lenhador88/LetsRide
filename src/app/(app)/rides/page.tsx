'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { RideCard } from '@/components/rides/RideCard'
import { RideFilterBar } from '@/components/rides/RideFilterBar'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonFilterBar, SkeletonList } from '@/components/ui/Skeleton'
import { getRideFilters, getRides } from '@/lib/data/rides'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { parseRideFilter } from '@/lib/validation/rides'
import type { RideFilter } from '@/types'

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
 * Every filter shows **upcoming** rides, which is what all four frames draw and
 * what the "You have no upcoming rides, yet!" empty state says. Ride history has
 * no screen in this flow; `RideCard` renders the design's past variants ("Went")
 * because a ride can pass while the page is open, but nothing here lists a ride
 * whose departure is behind us.
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
 * **The cold-load jump this gate used to leave behind is `RidesLoading`'s job,
 * and a padding class cannot do it (PD-217).** The pre-bar skeleton drew with
 * no filter bar at all, so every row dropped the bar's ~104px the moment
 * `filters.data` landed. A pass before that one wrapped the branch in `py-2`
 * believing it was the same gap and closed 8px of ~112 — the height has to be
 * *reserved*, which means a shape standing in for the bar.
 * `/postcards` has the same two-skeleton shape and needs nothing at all: its
 * deck skeleton is a centred, width-driven card, so vertical padding moves
 * neither its centre nor its size.
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

  return (
    <>
      <RideFilterBar filters={filters.data} active={filter} />

      {rides.error ? (
        <ErrorState onRetry={rides.refetch} />
      ) : !rides.data ? (
        // The wrapper, not the skeleton, carries `py-2`: `SkeletonList`'s root
        // is `px-4` only, and it now stands in the same slot as the loaded
        // list rather than replacing the screen — so without it every filter
        // tap ends with the cards jumping 8px as the data lands.
        //
        <div className="py-2">
          <SkeletonList />
        </div>
      ) : rides.data.length === 0 ? (
        <EmptyList filter={filter} />
      ) : (
        <div className="flex flex-col gap-2 px-4 py-2 motion-safe:animate-fade-in">
          {rides.data.map((ride) => (
            <RideCard key={ride.id} ride={ride} showClub={filter?.kind !== 'club'} />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * The screen before either read has landed, and it must be the *loaded* shape
 * with the content taken out — that is the whole fix for PD-217.
 *
 * Both cold-load positions render this one component: the `<Suspense>`
 * fallback, which stands in while `useSearchParams` resolves, and the
 * `!filters.data` gate below it. They were two different trees before — a bare
 * `SkeletonList` in each — so the bar's ~104px and the list wrapper's 8px both
 * appeared out of nowhere, one at each boundary, and every row moved down
 * twice on the way to a settled screen.
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

/**
 * Two of these three strings are the design's, verbatim. The club one is not
 * drawn — `Home - Rides - Rides from club` has no empty variant — so it is
 * written to match their shape rather than invented in a different voice.
 */
function EmptyList({ filter }: { filter?: RideFilter }) {
  const message =
    filter?.kind === 'mine'
      ? 'You have no upcoming rides, yet!'
      : filter?.kind === 'club'
        ? 'This club has no upcoming rides, yet!'
        : 'There are no rides, yet!'

  return (
    <p className="motion-safe:animate-fade-in px-4 py-24 text-center text-sm font-medium text-muted">
      {message}
    </p>
  )
}
