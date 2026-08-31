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
 * **The frame draws this slot, and this is an APPROXIMATION of it rather than
 * the thing itself.** `Private club - Timeline` (`2043:10604`) →
 * `v2 / Component / Navigation / Bar` is a 390×152 component whose
 * `Button Container 358×56` sits *inside* it, above `Navigation Items`, beneath
 * the bar's single `Grey/10%` top stroke — which is the `STICKY_ACTIONS`
 * construction, not a sibling. This component cannot be that, for the gating
 * reason below, so it reproduces the slot, the 358×40 primary and the geometry,
 * and drops its own border so the two read as one bar. What it does not
 * reproduce is being one element; if `Navbar`'s action slot ever learns a
 * predicate, this should move into it.
 *
 * What the frame does not have is three things to create — it predates `081`'s
 * threads — so the button opens a sheet rather than going straight to one
 * composer. **One primary and a sheet, rather than three buttons in a row**:
 * three primaries side by side is no primary at all, and it would be the only
 * place in the app where that slot holds more than one control. This costs a
 * tap and keeps the geometry the design specifies.
 *
 * ## Not in `STICKY_ACTIONS`, and that is not a shortcut
 *
 * `Navbar`'s map is keyed on pathname alone, and this bar is **member-only**:
 * `009`'s postcards INSERT policy and `017`'s rides INSERT policy both require
 * `private.is_club_member`, and `081` admits only members to a club's threads,
 * so all three destinations refuse a non-member — and a control that always
 * fails RLS is worse than no control. A pathname cannot answer that. So the
 * screen owns its bar, borrowing `RideAttendanceBar`'s `.bottom-navbar` offset
 * and `z-40` — which is a mechanism, not a precedent for the composition: that
 * bar's frame draws it stacked, this one's draws it integrated.
 *
 * It is an affordance and never the enforcement — a rider who defeats it is
 * refused by the policy.
 */
export function ClubCreateBar({ clubId }: { clubId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* **No `border-t`, and its absence is the whole point.** `.bottom-navbar`
          puts this bar's bottom edge exactly on the navigation bar's top edge,
          and that bar draws its own top border — so a border here would put TWO
          hairlines where the frame draws ONE, and make this the only create
          primary in the app that reads as a separate slab rather than part of
          the bar. `RideAttendanceBar` keeps its border because its own frame
          (`2375:8771`) draws it stacked ON the bar; replacing versus stacking is
          a per-screen fact the design states, and this screen's frame states
          the integrated 152px variant. Same background, no rule: one bar.

          `z-40` under the navigation bar's `z-50` — see globals.css. */}
      <div className="bottom-navbar fixed right-0 left-0 z-40 bg-background px-4 pt-4 pb-2">
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
