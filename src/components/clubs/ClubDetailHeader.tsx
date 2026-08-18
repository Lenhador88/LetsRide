import { Header } from '@/components/layout/Header'
import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { ClubOptionsMenu } from '@/components/clubs/ClubOptionsMenu'
import { routes } from '@/lib/routes'
import type { ClubDetail } from '@/types'

/** The three screens that still render this header — the merged detail
 * itself, plus the two roster/list sub-pages `See all` still reaches. */
export type ClubScreen = 'detail' | 'members' | 'rides'

/**
 * The chrome the three remaining club screens share — `v2 / Component /
 * Header` in its `Type=Club` shape: a 28px avatar beside the club name, back
 * at the left, the dots menu at the right.
 *
 * **The sub-page switcher is deleted, and with it the 120px variant.** The
 * club detail merge (2026-08-18, the club counterpart of PD-254) puts
 * Members and Upcoming rides on the detail screen itself as sections with
 * their own `See all`, so nothing here needs a row under the title any more —
 * every caller gets the plain 96px `Header`. `/clubs/detail/about` is
 * deleted outright: its one unambiguous action, leaving, moves into
 * `ClubOptionsMenu` below, and the rest of what it drew (type, created-at,
 * description) moves onto the merged screen next to the postcard timeline.
 *
 * **The header's right-hand control is now the dots menu, not a bare Edit
 * pencil.** Product owner, 2026-08-17: *"I tihnk we need the dots on the top
 * right. If owner we show the pencil, that also goes to an option udner the
 * dots."* `ClubOptionsMenu` owns both the owner's `Edit club` row and the
 * member's `Leave club` row; see its own docstring for the one row the
 * approved mock draws that is deliberately not built here (`Delete club`).
 * **A non-member gets no menu at all** — `action` below is `undefined` for
 * that viewer, same as it was `undefined` for anyone who was not the owner
 * before this change.
 *
 * **`current` still decides one thing a merged screen does not remove: where
 * back goes.** Reached only from the merged screen's `See all` now, so
 * Members' and Rides' back button returns to the club rather than to
 * `/clubs` — the same move `RideHeader` made for the crew route when the ride
 * switcher went, and for the identical reason: a back button that leaves the
 * screen a rider came from is the kind of thing nothing fails on.
 *
 * **`clubId` is taken separately from `club` so the header can draw before
 * the club arrives.** Back comes from the route segment (via `current`), so
 * the only things that wait on the read are the name, the avatar and the
 * menu — `club?.viewer_role` decides the last of those, and there is nothing
 * safe to show before it lands.
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
  current: ClubScreen
}) {
  return (
    <Header
      title={club?.name}
      backHref={current === 'detail' ? '/clubs' : routes.club(clubId)}
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
        club?.viewer_role ? (
          <ClubOptionsMenu clubId={clubId} isOwner={club.viewer_role === 'owner'} />
        ) : undefined
      }
    />
  )
}
