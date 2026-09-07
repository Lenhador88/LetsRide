'use client'

import { ChatBubbleIcon, ImageIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import type { RideCreateOption } from '@/types'

/**
 * What a ride creates — the sheet behind both of the ride detail's create
 * entrances (`108`, PD-402).
 *
 * **One component rather than one per entrance**, because the two entrances are
 * complementary by construction (`resolveRideDetailActions`) and the rows they
 * offer must be identical. The bar and the timeline heading's `(+)` mount this
 * with the same `options` array, read off the same decision, so they cannot
 * drift into offering different things.
 *
 * `ClubCreateAction`'s sheet is the model and the argument is its: **one
 * trigger and a sheet, rather than two buttons in a row** — two primaries side
 * by side is no primary at all, and it would be the only place in the app where
 * that slot holds more than one control. This costs a tap and keeps the
 * geometry the design specifies. (It was `ClubCreateBar` when that argument was
 * written; PD-404 moved both screens' triggers to `FloatingAction` and left
 * both sheets alone, which is the argument surviving rather than lapsing.)
 *
 * **The icon is chosen here rather than carried on the option**, because it is a
 * rendering concern and `RideCreateOption` is data: putting a component on the
 * type would make `lib/rides/bottom-slot.ts` — a pure function with an
 * exhaustive test — import from `components/`. The mapping is total over the
 * union, so a new `kind` is a type error here rather than a row that silently
 * draws nothing.
 */
const ICONS: Record<RideCreateOption['kind'], React.ReactNode> = {
  postcard: <ImageIcon className="h-6 w-6" aria-hidden="true" />,
  thread: <ChatBubbleIcon className="h-6 w-6" aria-hidden="true" />,
}

export function RideCreateSheet({
  options,
  open,
  onClose,
}: {
  /** From `resolveRideDetailActions`. Non-empty whenever either entrance is
   *  drawn — that invariant is pinned in `bottom-slot.ts`'s own test, so this
   *  component does not re-check it and must not start: a sheet that silently
   *  renders nothing is exactly the state the invariant exists to make
   *  impossible, and a guard here would hide it rather than prevent it. */
  options: RideCreateOption[]
  open: boolean
  onClose: () => void
}) {
  return (
    <ContextMenu open={open} onClose={onClose} label="Create on this ride">
      {options.map((option) => (
        <ContextMenuItem key={option.kind} href={option.href} icon={ICONS[option.kind]}>
          {option.label}
        </ContextMenuItem>
      ))}
    </ContextMenu>
  )
}
