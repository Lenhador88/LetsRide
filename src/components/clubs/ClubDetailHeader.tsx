import { Header } from '@/components/layout/Header'
import { Avatar } from '@/components/ui/Avatar'
import { ClubDetailPageMenu, type ClubPage } from '@/components/clubs/ClubDetailPageMenu'
import type { ClubDetail } from '@/types'

/**
 * The chrome all four club sub-pages share — `v2 / Component / Header` in its
 * `Type=Club` shape: a 28px avatar beside the club name, back at the left, and
 * the sub-page switcher on the row beneath.
 *
 * The design also draws an `Options` control at the right of the title row. It
 * is **omitted rather than stubbed**, on the same reasoning as the ride header:
 * the flow never draws the sheet it opens, and club overflow is presumably
 * edit / delete / leave — three rows of guesswork on a menu that would be
 * destructive. `RidePageMenu`'s note says the same thing about Ride Options.
 * Leaving a club is reachable from the About page instead, where it is one
 * labelled control rather than an invented menu.
 */
export function ClubDetailHeader({ club, current }: { club: ClubDetail; current: ClubPage }) {
  return (
    <Header
      title={club.name}
      backHref="/clubs"
      subRow={<ClubDetailPageMenu clubId={club.id} current={current} />}
      titleLeading={
        <Avatar
          src={club.avatar_url}
          name={club.name}
          size="xs"
          className="h-7 w-7 rounded-lg bg-surface"
        />
      }
    />
  )
}
