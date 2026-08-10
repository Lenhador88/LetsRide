import Link from 'next/link'
import { EditIcon } from '@/components/icons/generated'
import { Header } from '@/components/layout/Header'
import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
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
 *
 * **Edit is not that menu, and is built as of PD-101.** `design.md` §D4 puts
 * it in the header as its own affordance, owner-only, through `action` — free
 * here, unlike the ride header, because nothing else in this header claims it.
 * Delete stays off the header entirely, at the foot of the edit screen behind
 * a second tap.
 *
 * **`clubId` is taken separately from `club` so the header can draw before the
 * club arrives.** Back and the sub-page switcher both come from the route
 * segment, so the only two things that wait on the read are the name and the
 * avatar — and holding the whole header for them would leave a slow club with
 * no way out of it. Edit waits too, on the same read: `club.viewer_role` is
 * what decides it, and there is nothing safe to show before that lands.
 */
export function ClubDetailHeader({
  clubId,
  club,
  current,
}: {
  clubId: string
  /** `undefined` while the club is still being read — `Header` draws a
   * placeholder bar for the title. See that component's `title` prop. */
  club: ClubDetail | undefined
  current: ClubPage
}) {
  return (
    <Header
      title={club?.name}
      backHref="/clubs"
      subRow={<ClubDetailPageMenu clubId={clubId} current={current} />}
      titleLeading={
        club ? (
          <Avatar
            src={club.avatar_url}
            name={club.name}
            size="xs"
            className="h-7 w-7 rounded-lg bg-surface"
          />
        ) : (
          // The same 28px box the avatar occupies, so the title does not slide
          // sideways when the club lands.
          <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
        )
      }
      action={
        club?.viewer_role === 'owner' ? (
          <Link
            href={`/clubs/${clubId}/edit`}
            aria-label="Edit club"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
          >
            <EditIcon className="h-6 w-6" />
          </Link>
        ) : undefined
      }
    />
  )
}
