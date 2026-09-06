'use client'

import { Button } from '@/components/ui/Button'
import { routes } from '@/lib/routes'

/**
 * The ride's create bar — a sticky primary above the navigation bar, in the
 * slot `ClubCreateBar` occupies on the club detail (PD-401).
 *
 * Product owner, 2026-09-05, after PD-393 shipped: *"Lets have the create
 * button instead of a plus on timeline."* A `(+)` on a section heading is not
 * an affordance anyone finds, and the club detail settled this shape already.
 *
 * ## One primary, no sheet — and that is a deliberate non-generalisation
 *
 * The club's bar opens a `ContextMenu` because a club creates three things.
 * **A ride creates exactly one**: a postcard tagged to it
 * (`routes.newPostcardInRide`). A sheet holding a single row is a tap that
 * asks a question with one answer, so this navigates straight to the composer.
 *
 * PD-402 — retiring ride chat and giving a ride threads — is the story that
 * makes a second action exist, and the sheet shape becomes right on the day it
 * lands rather than before it. Building the sheet now would be furniture
 * around an empty second slot.
 *
 * ## The geometry is `ClubCreateBar`'s, borrowed on purpose
 *
 * `.bottom-navbar` puts the bar's bottom edge exactly on the navigation bar's
 * top edge; `z-40` sits under that bar's `z-50` (see globals.css); and there
 * is **no `border-t`**, because the navigation bar draws its own and two
 * hairlines where the frame draws one is the defect that rule prevents. The
 * page tops its own padding up by `.pb-navbar-action-extra`, the same class
 * the club detail uses for the same bar.
 *
 * `RideAttendanceBar` keeps its border and this does not, which looks
 * inconsistent and is not: replacing versus stacking is a per-screen fact the
 * design states, and that bar's own frame (`2375:8771`) draws it stacked ON
 * the navigation bar where the create slot is drawn integrated. The two never
 * appear together — see the page.
 *
 * ## It is an affordance, never the enforcement
 *
 * The caller gates this on crew membership because `041` requires
 * `private.is_ride_crew` to tag a postcard to a ride. A rider who defeats the
 * control is refused by the policy; a control the database always refuses is
 * worse than no control at all.
 */
export function RideCreateBar({ rideId }: { rideId: string }) {
  return (
    <div className="bottom-navbar fixed right-0 left-0 z-40 bg-background px-4 pt-4 pb-2">
      <div className="mx-auto max-w-lg">
        {/* The label names the act rather than the category. The club's says
            `Create` because it opens a menu of three; with one destination,
            `Create` would make the rider tap to find out what it creates. */}
        <Button href={routes.newPostcardInRide(rideId)} size="md" className="text-base">
          Add a photo
        </Button>
      </div>
    </div>
  )
}
