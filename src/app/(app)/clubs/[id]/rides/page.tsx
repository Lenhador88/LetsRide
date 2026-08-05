import { notFound } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { RideCard } from '@/components/rides/RideCard'
import { getClub } from '@/lib/data/clubs'
import { getRides } from '@/lib/data/rides'

/**
 * `Private club - Rides` (`2059:6390`).
 *
 * `showClub={false}` for the same reason `/rides?club=` drops the chip: every
 * card here belongs to the club already named in the header, and the design's
 * card is 128 tall rather than 156 when the chip is absent.
 *
 * Past rides are not shown, because `getRides` filters to upcoming and the
 * design draws no past section here. `RideCard` can render the `Went` variants,
 * so the day a history screen is designed it needs a query, not a component.
 */
export default async function ClubRidesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const club = await getClub(id)
  if (!club) notFound()

  const rides = await getRides({ kind: 'club', id: club.id })

  return (
    <>
      <ClubDetailHeader club={club} current="rides" />

      {rides.length === 0 ? (
        <p className="py-8 text-center text-sm font-medium text-muted">
          No rides are planned, yet!
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rides.map((ride) => (
            <li key={ride.id}>
              <RideCard ride={ride} showClub={false} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
