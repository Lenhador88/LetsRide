import { notFound } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { MarkClubSeen } from '@/components/clubs/MarkClubSeen'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { RideCard } from '@/components/rides/RideCard'
import { getClub } from '@/lib/data/clubs'
import { getClubFeed } from '@/lib/data/postcards'
import { getRides } from '@/lib/data/rides'

/**
 * How many upcoming rides the timeline strip shows. The design draws three in a
 * horizontal scroller; five gives it something to scroll without turning the
 * sub-page into the Rides sub-page, which is one tap away.
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
 */
export default async function ClubTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const club = await getClub(id)
  if (!club) notFound()

  const [postcards, rides] = await Promise.all([
    getClubFeed(club.id),
    getRides({ kind: 'club', id: club.id }, CLUB_TIMELINE_RIDES),
  ])

  return (
    <>
      <ClubDetailHeader club={club} current="timeline" />
      {club.viewer_role && <MarkClubSeen clubId={club.id} />}

      {rides.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-muted">Upcoming rides</h2>
          {/* The design scrolls these horizontally as `Collection / Ride`
              chips. They render as the list card here: one component that is
              already measured beats a second one that is not, and the chip is
              the same three facts in a smaller box. Registered as a fidelity
              gap rather than passed off as the drawn control. */}
          <div className="flex flex-col gap-2">
            {rides.map((ride) => (
              <RideCard key={ride.id} ride={ride} showClub={false} />
            ))}
          </div>
        </section>
      )}

      {postcards.length === 0 ? (
        <p className="py-8 text-center text-sm font-medium text-muted">
          Nothing has been posted here, yet!
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {postcards.map((postcard) => (
            <PostcardCard key={postcard.id} postcard={postcard} />
          ))}
        </div>
      )}
    </>
  )
}
