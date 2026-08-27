import Link from 'next/link'
import { notificationCopy } from '@/components/notifications/copy'
import { RideInviteActions } from '@/components/notifications/RideInviteActions'
import { NotificationRow } from '@/components/ui/NotificationRow'
import { routes } from '@/lib/routes'
import { formatNotificationStamp } from '@/lib/utils'
import type { NotificationRow as NotificationRowData } from '@/types'

type NotificationsListItemProps = {
  row: NotificationRowData
  /**
   * The signed-in reader, or undefined if the session went away mid-render.
   * `ride_joined` says something different to the ride's organizer than to the
   * rest of its crew, so the row cannot write its own copy without it — see
   * `notificationCopy`.
   */
  viewerId: string | undefined
}

/**
 * Resolves one `NotificationRow` (the data shape, `@/types`) into the
 * presentational `NotificationRow` component (`@/components/ui`) plus a link
 * to its subject. This is the per-`type` branching `design.md` §D9 keeps out
 * of that component on purpose — it is purely presentational and does not
 * know what a notification `type` is, so the caller supplies already-resolved
 * strings and wraps the row itself.
 *
 * `href` is null only in a state `036` §3's SELECT policy is supposed to make
 * unreachable — a row whose subject did not resolve is not returned at all —
 * so this degrades to an unlinked row rather than asserting the invariant and
 * crashing on it.
 */
export function NotificationsListItem({ row, viewerId }: NotificationsListItemProps) {
  const actorName = row.actor?.username ?? 'Rider'
  const stamp = formatNotificationStamp(row.created_at)
  const { href, trailing } = describe(row)
  const copy = notificationCopy(row, viewerId)

  const content = (
    <NotificationRow
      actorName={actorName}
      avatarUrl={row.actor?.avatar_url}
      stamp={stamp}
      copy={copy}
      trailing={trailing}
    />
  )

  // `083`, PD-329. Rendered BESIDE the row rather than inside it, and outside
  // the `<Link>`: a button nested in an anchor is invalid HTML and the tap
  // would navigate as well as answer. Only `ride_invited` draws anything —
  // `RideInviteActions` returns null for every other case, including a
  // `ride_invited` row whose invite is no longer live.
  const actions =
    row.type === 'ride_invited' ? <RideInviteActions rideId={row.ride?.id} /> : null

  if (!href) {
    return (
      <>
        {content}
        {actions}
      </>
    )
  }

  return (
    <>
      <Link href={href} className="block transition-colors active:bg-border">
        {content}
      </Link>
      {actions}
    </>
  )
}

/**
 * Where the row goes and what sits in its trailing slot. The copy is
 * `notificationCopy`'s, because it depends on the reader as well as the row and
 * is the one piece of this with no JSX in it.
 */
function describe(row: NotificationRowData): {
  href: string | null
  trailing?: React.ReactNode
} {
  switch (row.type) {
    case 'postcard_liked':
    case 'postcard_commented':
      return {
        href: row.postcard ? routes.postcard(row.postcard.id) : null,
        trailing: postcardThumbnail(row),
      }
    case 'ride_joined':
    case 'ride_created_in_club':
    // `083`'s three. The destination is the ride for all of them — for the two
    // answers because that is what the organizer wants to look at, and for
    // `ride_invited` because tapping the row should show the rider what they
    // are being asked to. The Accept/Decline pair sits beside the link rather
    // than replacing it.
    case 'ride_invited':
    case 'ride_invite_accepted':
    case 'ride_invite_declined':
      // Destination is the ride for both — for `ride_created_in_club` the club
      // is context the copy names rather than where the row leads, per `036`'s
      // comment on `notifications.club_id`. No trailing thumbnail either: the
      // frame draws a map tile with a pin overlay, which is an open design
      // question logged in docs/FIGMA-FIDELITY-TODO.md rather than a guess.
      return { href: row.ride ? routes.ride(row.ride.id) : null }
    case 'club_joined':
      return {
        href: row.club ? routes.club(row.club.id) : null,
        trailing: row.club?.avatar_url ? (
          <img src={row.club.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : undefined,
      }
  }
}

function postcardThumbnail(row: NotificationRowData): React.ReactNode {
  return row.postcard?.image_url ? (
    <img src={row.postcard.image_url} alt="" className="h-full w-full object-cover" />
  ) : undefined
}
