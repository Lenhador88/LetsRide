'use client'

import { notFound, useParams } from 'next/navigation'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListUser } from '@/components/ui/ListUser'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { RideHeader } from '@/components/rides/RideHeader'
import { getRide, getRideCrew, withOrganizer } from '@/lib/data/rides'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
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
export default function RideCrewPage() {
  const { id } = useParams<{ id: string }>()

  // The ride read is not redundant with the crew read: it supplies the header
  // title and the organizer, and it is also the authorization probe — a ride
  // you cannot see returns null here, where `ride_members` would just return an
  // empty roster and render a crew page for a ride that is not yours to know
  // exists.
  //
  // Issued *alongside* the crew rather than before it, where the server version
  // awaited one and then the other. That means the roster is read even for a
  // ride that turns out to be invisible, which costs one wasted query on a 404
  // and saves a round trip on every real load. It cannot leak: 009 delegates
  // the `ride_members` SELECT policy to the rides one, so the wasted case comes
  // back empty rather than as somebody else's crew.
  const ride = useQuery(queryKeys.rides.detail(id), () => getRide(id))
  const roster = useQuery(queryKeys.rides.crew(id), () => getRideCrew(id))

  // `null` is the decided answer — no such ride, or none you may see. Only that
  // is a 404; `undefined` is the effect not having answered yet, and 404ing on
  // it would flash one on every load.
  if (ride.data === null) notFound()

  const crew =
    ride.data && roster.data
      ? withOrganizer(roster.data, ride.data.organizer_id, ride.data.organizer)
      : null

  // Every ride sub-page's header carries the chat entry points, so every one of
  // them owes this — read from `getRide` rather than re-derived here. See the
  // ride plan page.
  const isCrew = ride.data?.is_crew

  const gate = combineQueries(ride, roster)

  return (
    <>
      {/* The title is the only part of the chrome that needs the read — the
          ride id, the back target and the sub-page switcher all come out of the
          URL — so the header renders straight away, with `undefined` for the
          title and a placeholder bar in its place, rather than the whole screen
          waiting on it. */}
      <RideHeader
        rideId={id}
        title={ride.data?.title}
        current="crew"
        isCrew={isCrew}
        isOrganizer={ride.data?.is_organizer}
      />

      <div className="pt-header-sub-extra flex flex-col gap-4 pb-4">
        {gate.error ? (
          <ErrorState onRetry={gate.refetch} />
        ) : !crew ? (
          // Gated on the data, not on `isLoading` — see `combineQueries` for
          // the tick where `isLoading` is false and there is nothing to draw.
          <SkeletonList />
        ) : (
          <>
            <CrewSection title="Going" members={crew.going} />
            {crew.maybe.length > 0 && <CrewSection title="May be going" members={crew.maybe} />}
          </>
        )}
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
