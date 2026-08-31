'use client'

import Link from 'next/link'
import { BikeIcon, ChatBubbleIcon, ImageIcon } from '@/components/icons/generated'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { getClubThreadUnread } from '@/lib/data/club-threads'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/**
 * The club's narrow action layer — the band between the upcoming rides and the
 * timeline (product owner, 2026-08-31: *"a narrow layer with add postcard,
 * create ride, create postcard, threads, etc."*).
 *
 * ## Why it exists at all, given the timeline below it
 *
 * Dissolving the Postcards carousel and the Threads section into the timeline
 * took three entrances with it: the two `(+)` controls those sections carried,
 * and `Threads`' own `See all`. A timeline is a record of what has happened and
 * a bad place to hang a create — an entry cannot both report the past and start
 * something. So the entrances move here, in one row, where they are visible
 * without scrolling past a single event.
 *
 * ## Members only, and that is RLS rather than taste
 *
 * All three destinations refuse a non-member: `009`'s postcards INSERT policy
 * and `017`'s rides INSERT policy both require `private.is_club_member`, and
 * `081` admits only members to a club's threads — so a non-member of a *public*
 * club, who can read this screen, would get three controls that each fail. A
 * control that always fails RLS is worse than no control (the same call
 * `ClubCreateRideRow` makes). The club detail renders `ClubMembershipButton` in
 * this slot instead; the decision is the page's, not this component's.
 *
 * ## The unread dot is the one thing that had to survive the dissolve
 *
 * `081` shipped a per-thread unread mark, and it was legible because Threads
 * was a section of its own near the top. On a timeline a thread with unread
 * messages sinks with age, so a club whose conversation went quiet for a month
 * would bury its own unread mark under thirty joins. This row carries the
 * aggregate — *something* in Threads is unread — and `ClubTimelineRow` still
 * marks the individual entry. Neither replaces the other: this one says go
 * look, that one says where.
 *
 * The read is `clubs.threadsUnread`, the same key the timeline reads, so the
 * two share one request rather than making two — `queryClient` dedupes an
 * identical key already in flight.
 */
export function ClubActionRow({ clubId }: { clubId: string }) {
  // Fails to nothing, exactly as `ClubThreadsSection` does: a failed unread
  // call resolves to `{}` inside `getClubThreadUnread`, so the row renders
  // unmarked rather than not rendering. `undefined` while it is out reads the
  // same way — an absent dot is the honest state before the answer lands.
  const unread = useQuery(queryKeys.clubs.threadsUnread(clubId), () =>
    getClubThreadUnread(clubId)
  )
  const hasUnreadThreads = Object.values(unread.data ?? {}).some(Boolean)

  return (
    <nav aria-label="Club actions" className="flex gap-2 px-4">
      <ActionTile href={routes.newPostcardInClub(clubId)} label="Postcard">
        <ImageIcon className="h-5 w-5" aria-hidden="true" />
      </ActionTile>
      <ActionTile href={routes.newRideInClub(clubId)} label="Ride">
        <BikeIcon className="h-5 w-5" aria-hidden="true" />
      </ActionTile>
      <ActionTile
        href={routes.clubThreads(clubId)}
        label="Threads"
        // In words, because `NotificationDot` is `aria-hidden` by construction
        // and the dot is the only thing distinguishing the two states.
        description={hasUnreadThreads ? 'Threads, unread messages' : undefined}
      >
        <ChatBubbleIcon className="h-5 w-5" aria-hidden="true" />
        {hasUnreadThreads && <NotificationDot className="absolute right-1 top-1 h-3 w-3" />}
      </ActionTile>
    </nav>
  )
}

function ActionTile({
  href,
  label,
  description,
  children,
}: {
  href: string
  label: string
  /** Overrides the visible label for assistive tech when the tile carries state
   *  the label does not say. */
  description?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-label={description}
      // 56px: above the 44px glove minimum `rider-ux` holds every tap target
      // to, and short enough that the row reads as a band rather than a third
      // section. `flex-1` over three tiles rather than a scroller — three fit
      // on the narrowest phone this app targets, and a scrolling action row
      // hides its own last option.
      className="relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl bg-track text-foreground transition-colors active:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
      <span className="text-xs font-semibold">{label}</span>
    </Link>
  )
}
