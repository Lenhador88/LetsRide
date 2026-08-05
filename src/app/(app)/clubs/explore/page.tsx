import { Header } from '@/components/layout/Header'
import { ClubCard } from '@/components/clubs/ClubCard'
import { ClubPageMenu } from '@/components/clubs/ClubPageMenu'
import { getExploreClubs } from '@/lib/data/clubs'

/**
 * `Clubs - Explore` (`1918:9610`) — public clubs this rider has not joined.
 *
 * A real route rather than `/clubs?tab=explore`, following the ride detail's
 * sub-pages. A query parameter would have to be parsed and validated before it
 * reached a query, which is the defect `?club=` shipped on the rides list; a
 * segment cannot be malformed.
 *
 * Every row here is `is Joined=False`, so the trailing slot is `Join club` and
 * never the unread counter — 015 will not accept a watermark for a club the
 * rider has not joined, so the two agree by construction rather than by
 * convention.
 */
export default async function ExploreClubsPage() {
  const clubs = await getExploreClubs()

  return (
    <>
      <Header title="Clubs" subRow={<ClubPageMenu current="explore" />} />

      <div className="pt-header-sub-extra px-4">
        {clubs.length === 0 ? (
          <p className="py-8 text-center text-sm font-medium text-muted">
            There are no public clubs, yet!
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {clubs.map((club) => (
              <li key={club.id}>
                <ClubCard club={club} joined={false} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
