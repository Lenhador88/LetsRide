import { Header } from '@/components/layout/Header'
import { RideCard } from '@/components/rides/RideCard'
import { RideFilterBar } from '@/components/rides/RideFilterBar'
import { getRideFilters, getRides } from '@/lib/data/rides'
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
 */
export default async function RidesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; club?: string }>
}) {
  const { filter: filterParam, club } = await searchParams

  // "Mine" and a club at once is not a state the design has, and intersecting
  // them would quietly return nothing. First one wins — as on /postcards.
  const filter: RideFilter | undefined =
    filterParam === 'mine' ? { kind: 'mine' } : club ? { kind: 'club', id: club } : undefined

  // The filter bar always describes every upcoming ride, never the filtered
  // slice — otherwise picking a club would erase every other tile and strand
  // you there with no way back.
  const [rides, filters] = await Promise.all([getRides(filter), getRideFilters()])

  return (
    <>
      <Header title="Rides" />
      {/* The shell reserves the 88px nav bar; this screen's bar is the 152px
          variant, so it owes the sticky action's own height: 16 pad + 40 button
          + 8 = 64px. */}
      <div className="flex flex-col pb-16">
        <RideFilterBar filters={filters} active={filter} />

        {rides.length === 0 ? (
          <EmptyList filter={filter} />
        ) : (
          <div className="flex flex-col gap-2 px-4 py-2">
            {rides.map((ride) => (
              <RideCard key={ride.id} ride={ride} showClub={filter?.kind !== 'club'} />
            ))}
          </div>
        )}
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
    <p className="px-4 py-24 text-center text-sm font-medium text-muted">{message}</p>
  )
}
