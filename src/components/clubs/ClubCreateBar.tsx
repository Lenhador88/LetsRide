'use client'

import { useState } from 'react'
import { BikeIcon, ChatBubbleIcon, ImageIcon } from '@/components/icons/generated'
import { Button } from '@/components/ui/Button'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { routes } from '@/lib/routes'

/**
 * The club's create bar — a sticky primary above the navigation bar, in the
 * slot `Create club` occupies on `/clubs` (product owner, 2026-08-31: *"can we
 * also try the button creates postcard, ride or thread to be on a bottom bar
 * like the one create club on the club list?"*).
 *
 * **The frame draws exactly this slot**: `Private club - Timeline`
 * (`2043:10604`) → `v2 / Component / Navigation / Bar` carries a
 * `Button Container` with one 358×40 primary reading `Create postcard` above
 * the tab tiles. What the frame does not have is three things to create — it
 * predates `081`'s threads — so the button opens a sheet rather than going
 * straight to one composer. **One primary and a sheet, rather than three
 * buttons in a row**: three primaries side by side is no primary at all, and it
 * would be the only place in the app where that slot holds more than one
 * control. This costs a tap and keeps the geometry the design specifies.
 *
 * ## Not in `STICKY_ACTIONS`, and that is not a shortcut
 *
 * `Navbar`'s map is keyed on pathname alone, and this bar is **member-only**:
 * `009`'s postcards INSERT policy and `017`'s rides INSERT policy both require
 * `private.is_club_member`, and `081` admits only members to a club's threads,
 * so all three destinations refuse a non-member — and a control that always
 * fails RLS is worse than no control. A pathname cannot answer that. So the
 * screen owns its bar, exactly as `RideAttendanceBar` does for the same reason
 * (it needs the ride's own crew state), and it uses that component's
 * `.bottom-navbar` offset and `z-40` so it sits above the tabs rather than over
 * them.
 *
 * It is an affordance and never the enforcement — a rider who defeats it is
 * refused by the policy.
 */
export function ClubCreateBar({ clubId }: { clubId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* `z-40` under the navigation bar's `z-50`, and `.bottom-navbar` puts it
          directly above — see globals.css and `RideAttendanceBar`, which is the
          same arrangement on the ride plan. */}
      <div className="bottom-navbar fixed right-0 left-0 z-40 border-t border-border bg-background px-4 pt-4 pb-2">
        <div className="mx-auto max-w-lg">
          <Button size="md" className="text-base" onClick={() => setOpen(true)}>
            Create
          </Button>
        </div>
      </div>

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Create in this club">
        {/* Postcard first: it is the one the frame names in this slot, and the
            one a rider reaches for most. Each row carries the club, so every
            composer opens already scoped to it and `backFromCreateScreen`
            returns here — see `CREATE_CLUB_PARAM`. */}
        <ContextMenuItem
          href={routes.newPostcardInClub(clubId)}
          icon={<ImageIcon className="h-6 w-6" aria-hidden="true" />}
        >
          Postcard
        </ContextMenuItem>
        <ContextMenuItem
          href={routes.newRideInClub(clubId)}
          icon={<BikeIcon className="h-6 w-6" aria-hidden="true" />}
        >
          Ride
        </ContextMenuItem>
        <ContextMenuItem
          href={routes.newClubThread(clubId)}
          icon={<ChatBubbleIcon className="h-6 w-6" aria-hidden="true" />}
        >
          Thread
        </ContextMenuItem>
      </ContextMenu>
    </>
  )
}
