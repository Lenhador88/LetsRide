'use client'

import { useState } from 'react'
import { ChevronDownIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'

/**
 * The header's sub-page switcher — `Ride plan ⌄` opening the sheet drawn in
 * `Ride - Ride plan - Sub pages` (`2375:9114`).
 *
 * The sheet lists exactly three destinations. **Chat is not one of them**: it is
 * the chat-bubble button in the header's action row, which is why it is absent
 * here rather than missing. Journal is listed by the design and is not built —
 * it needs `postcards.ride_id`, which does not exist — so it is omitted rather
 * than offered as a dead row. That is a deviation from a drawn menu and is
 * logged in docs/FIGMA-FIDELITY-TODO.md §Ride detail.
 */
export function RidePageMenu({
  rideId,
  current,
}: {
  rideId: string
  current: 'plan' | 'crew'
}) {
  const [open, setOpen] = useState(false)

  const pages = [
    { key: 'plan' as const, label: 'Ride plan', href: `/rides/${rideId}` },
    { key: 'crew' as const, label: 'Crew', href: `/rides/${rideId}/crew` },
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
