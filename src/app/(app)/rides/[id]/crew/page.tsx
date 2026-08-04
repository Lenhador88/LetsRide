import { notFound } from 'next/navigation'
import { ListUser } from '@/components/ui/ListUser'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { RideHeader } from '@/components/rides/RideHeader'
import { getRide, getRideCrew, withOrganizer } from '@/lib/data/rides'
import type { RideCrewMember } from '@/types'

/**
 * `Ride - Crew (Riders)` (`2375:9212`) — the roster, in the design's two
 * sections.
 *
 * There is no third section for riders who declined, and that is a schema fact
 * rather than an omission: `No` deletes the `ride_members` row. See `RideCrew`.
 *
 * The design's nav bar on this screen carries a sticky **"Bring a rider"**
 * action. Not built — inviting is its own flow (`Invite riders` /
 * `Invite riders - Filled` under the `Rides` section) with no schema behind it
 * yet. Logged in docs/FIGMA-FIDELITY-TODO.md §Ride detail.
 */
export default async function RideCrewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // The ride read is not redundant with the crew read: it supplies the header
  // title and the organizer, and it is also the authorization probe — a ride
  // you cannot see returns null here, where `ride_members` would just return an
  // empty roster and render a crew page for a ride that is not yours to know
  // exists.
  const ride = await getRide(id)
  if (!ride) notFound()

  const crew = withOrganizer(await getRideCrew(id), ride.organizer_id, ride.organizer)

  return (
    <>
      <RideHeader rideId={ride.id} title={ride.title} current="crew" />

      <div className="pt-header-sub-extra flex flex-col gap-4 pb-4">
        <CrewSection title="Going" members={crew.going} />
        {crew.maybe.length > 0 && <CrewSection title="May be going" members={crew.maybe} />}
      </div>
    </>
  )
}

function CrewSection({ title, members }: { title: string; members: RideCrewMember[] }) {
  return (
    <section className="flex flex-col">
      <SectionHeader title={title} meta={`(${members.length})`} />
      {members.map((member) => (
        <ListUser
          key={member.user_id}
          // A profile the viewer cannot read comes back null — blocked, or a
          // rider who has not finished onboarding and so has no username. The
          // row still exists in the count, so it renders rather than vanishing.
          name={member.profile?.username ?? 'Rider'}
          avatarUrl={member.profile?.avatar_url}
          isHost={member.is_host}
          note={member.is_host ? 'Ride host' : undefined}
        />
      ))}
    </section>
  )
}
