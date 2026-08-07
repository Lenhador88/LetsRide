'use client'

import { useState } from 'react'
import { ChevronDownIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'

/**
 * The header's sub-page switcher — `Ride plan ⌄` opening the sheet drawn in
 * `Ride - Ride plan - Sub pages` (`2375:9114`).
 *
 * Journal is listed by the design and is not built — it needs `postcards.ride_id`,
 * which does not exist — so it is omitted rather than offered as a dead row. That
 * is a deviation from a drawn menu and is logged in
 * docs/FIGMA-FIDELITY-TODO.md §Ride detail.
 *
 * **Chat is listed here even though the design does not list it, and that is the
 * second deviation.** The frame puts chat in the header's action row as a bare
 * 24×24 chat bubble and nowhere else, and this file used to record that as the
 * reason it was absent — "it is the chat-bubble button in the header's action
 * row, which is why it is absent here rather than missing". Measured against a
 * real rider on 2026-08-07: the product owner, organizer and `going` on all five
 * rides in the database, could not find the chat at all and opened this sheet
 * looking for it. An unlabelled icon in a corner is not a route anyone finds; a
 * sheet listing every other sub-page by name is where they look. So the icon
 * stays — it is drawn, and it is one tap — and the labelled row is added beside
 * it.
 *
 * It appears **only for the crew**, on exactly the predicate that gates the icon,
 * so the two entry points cannot disagree about who has a chat to open. See
 * `RideHeader`.
 */
export function RidePageMenu({
  rideId,
  current,
  isCrew,
}: {
  rideId: string
  current: 'plan' | 'crew'
  /**
   * Whether this rider is on the ride — organizer, or any RSVP. `undefined`
   * while the ride is still being read, which is why the Chat row appears a
   * moment after the sheet's other rows rather than being drawn and withdrawn.
   *
   * Required for the same reason `RideHeader`'s copy of it is: optional, a new
   * ride sub-page forgets it and the row silently never renders, which is
   * indistinguishable from a row nobody wanted. That failure already shipped
   * once — see `RideHeader`.
   */
  isCrew: boolean | undefined
}) {
  const [open, setOpen] = useState(false)

  const pages = [
    { key: 'plan' as const, label: 'Ride plan', href: `/rides/${rideId}` },
    { key: 'crew' as const, label: 'Crew', href: `/rides/${rideId}/crew` },
    // Ordered last because it is the one destination that is not a view of the
    // ride's own record, and because the design's own row order (plan, journal,
    // crew) puts the ride's data first.
    ...(isCrew ? [{ key: 'chat' as const, label: 'Chat', href: `/rides/${rideId}/chat` }] : []),
  ]
  const label = pages.find((page) => page.key === current)?.label ?? 'Ride plan'

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

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Ride pages">
        {pages.map((page) => (
          <ContextMenuItem
            key={page.key}
            href={page.href}
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
