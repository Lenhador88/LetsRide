import { Header } from '@/components/layout/Header'
import { ClubCard } from '@/components/clubs/ClubCard'
import { ClubPageMenu } from '@/components/clubs/ClubPageMenu'
import { getYourClubs } from '@/lib/data/clubs'

/**
 * `Clubs - Your clubs` (`1914:6862`) — every club this rider has joined.
 *
 * The Clubs tab is two sub-pages behind the header's dropdown, the same
 * mechanism the ride detail uses, and `/clubs/explore` is the other one. The
 * `Create club` primary sits in the Navbar's sticky action slot, which is where
 * the design puts it: inside the bar, above the tabs.
 *
 * `.pt-header-sub-extra` on top of the shell's `.pt-header`, because the
 * sub-page row makes the header 120 tall rather than 96. It is a 24px top-up
 * rather than a replacement — omitting it leaves 24px of content underneath.
 */
export default async function ClubsPage() {
  const clubs = await getYourClubs()

  return (
    <>
      <Header title="Clubs" subRow={<ClubPageMenu current="yours" />} />

      <div className="pt-header-sub-extra px-4">
        {clubs.length === 0 ? (
          // The design's empty state is one line of Grey/80 at Poppins/14/Medium
          // and nothing else — no illustration, and no second Create button,
          // since the sticky action is already on screen.
          <p className="py-8 text-center text-sm font-medium text-muted">You have no clubs, yet!</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {clubs.map((club) => (
              <li key={club.id}>
                <ClubCard club={club} joined />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
