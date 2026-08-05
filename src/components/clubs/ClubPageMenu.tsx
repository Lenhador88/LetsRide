'use client'

import { useState } from 'react'
import { ChevronDownIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'

/**
 * The header's sub-page switcher — `Your clubs ⌄` / `Explore clubs ⌄`.
 *
 * The Clubs tab is two screens behind one header, exactly like the ride detail:
 * `Clubs - Your clubs` (`1914:6862`) and `Clubs - Explore` (`1918:9610`) differ
 * only in this label and in what fills the row's trailing slot.
 *
 * There is a second, unrelated `Clubs - Explore` in the same flow (`1918:10353`)
 * drawing a two-column grid of 175×190 tiles. It is **not** a newer iteration of
 * this screen: its epic cover reads `Explore clubs v2 — On hold`, while the one
 * built here is `Explore clubs — Done`. It also composes a local unnamed frame
 * rather than the published `List / Club` component. Recorded so the next
 * session does not re-litigate which of the two is canonical.
 */
const pages = [
  { key: 'yours' as const, label: 'Your clubs', href: '/clubs' },
  { key: 'explore' as const, label: 'Explore clubs', href: '/clubs/explore' },
]

export function ClubPageMenu({ current }: { current: 'yours' | 'explore' }) {
  const [open, setOpen] = useState(false)
  const label = pages.find((page) => page.key === current)?.label ?? 'Your clubs'

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
