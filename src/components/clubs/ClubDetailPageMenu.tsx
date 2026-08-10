'use client'

import { useState } from 'react'
import { ChevronDownIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { routes } from '@/lib/routes'

export type ClubPage = 'timeline' | 'rides' | 'members' | 'about'

/**
 * The club detail's sub-page switcher, drawn in `Private club - Sub Pages`
 * (`2059:5931`) — the same bottom-sheet mechanism as the ride detail, not tabs.
 *
 * All four destinations are built, which is why none is omitted here. The ride
 * detail drops Journal and Chat from its own menu because neither has a table;
 * every club sub-page reads something that already exists — `postcards` scoped
 * by `club_id`, `rides` by `club_id`, `club_members`, and the club row itself.
 */
const pages: { key: ClubPage; label: string; href: (clubId: string) => string }[] = [
  { key: 'timeline', label: 'Timeline', href: routes.club },
  { key: 'rides', label: 'Rides', href: routes.clubRides },
  { key: 'members', label: 'Members', href: routes.clubMembers },
  { key: 'about', label: 'About', href: routes.clubAbout },
]

export function ClubDetailPageMenu({
  clubId,
  current,
}: {
  clubId: string
  current: ClubPage
}) {
  const [open, setOpen] = useState(false)
  const label = pages.find((page) => page.key === current)?.label ?? 'Timeline'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-medium text-foreground"
      >
        {label}
        <ChevronDownIcon className="h-5 w-5" />
      </button>

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Club pages">
        {pages.map((page) => (
          <ContextMenuItem
            key={page.key}
            href={page.href(clubId)}
            selected={page.key === current}
            onClick={() => setOpen(false)}
          >
            {page.label}
          </ContextMenuItem>
        ))}
      </ContextMenu>
    </>
  )
}
