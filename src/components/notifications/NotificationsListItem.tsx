import Link from 'next/link'
import { NotificationRow } from '@/components/ui/NotificationRow'
import { formatNotificationStamp } from '@/lib/utils'
import type { NotificationRow as NotificationRowData } from '@/types'

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
export function NotificationsListItem({ row }: { row: NotificationRowData }) {
  const actorName = row.actor?.username ?? 'Rider'
  const stamp = formatNotificationStamp(row.created_at)
  const { copy, href, trailing } = describe(row)

  const content = (
    <NotificationRow
      actorName={actorName}
      avatarUrl={row.actor?.avatar_url}
      stamp={stamp}
      copy={copy}
      trailing={trailing}
    />
  )

  if (!href) return content

  return (
    <Link href={href} className="block transition-colors active:bg-border">
      {content}
    </Link>
  )
}

function describe(row: NotificationRowData): {
  copy: string
  href: string | null
  trailing?: React.ReactNode
} {
  switch (row.type) {
    case 'postcard_liked':
      return {
        copy: 'liked your postcard.',
        href: row.postcard ? `/postcards/${row.postcard.id}` : null,
        trailing: postcardThumbnail(row),
      }
    case 'postcard_commented':
      return {
        copy: 'commented on your postcard.',
        href: row.postcard ? `/postcards/${row.postcard.id}` : null,
        trailing: postcardThumbnail(row),
      }
    case 'ride_joined':
      // Q2b's default: the drawn copy ("joined a ride you also joined.") is
      // written for an attendee, and Q1's default recipient — the organizer
      // alone — is who this app actually notifies. This is the minimal
      // rewrite that matches the recipient it is shown to; it reverts to the
      // drawn string the day Q1 is answered the other way. No trailing
      // thumbnail: `rides` has no image column, so there is nothing to sign —
      // logged in docs/FIGMA-FIDELITY-TODO.md rather than a placeholder.
      return { copy: 'joined your ride.', href: row.ride ? `/rides/${row.ride.id}` : null }
    case 'ride_created_in_club':
      // Q2's default: the issue's own string, verbatim, in the same shape as
      // the drawn rows. Destination is the ride, not the club — the club is
      // context the copy names, per `036`'s comment on `notifications.club_id`.
      return {
        copy: `created a ride in ${row.club?.name ?? 'a club'}.`,
        href: row.ride ? `/rides/${row.ride.id}` : null,
      }
    case 'club_joined':
      return {
        copy: `joined club ${row.club?.name ?? 'a club'}.`,
        href: row.club ? `/clubs/${row.club.id}` : null,
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
