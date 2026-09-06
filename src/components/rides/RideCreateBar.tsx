'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { RideCreateSheet } from '@/components/rides/RideCreateSheet'
import type { RideCreateOption } from '@/types'

/**
 * The ride's create bar — a sticky primary above the navigation bar, in the
 * slot `ClubCreateBar` occupies on the club detail (PD-401).
 *
 * Product owner, 2026-09-05, after PD-393 shipped: *"Lets have the create
 * button instead of a plus on timeline."* A `(+)` on a section heading is not
 * an affordance anyone finds, and the club detail settled this shape already.
 *
 * ## It opens a sheet as of `108` (PD-402), and that was predicted rather than
 * discovered
 *
 * PD-401 shipped this as a single primary straight to the postcard composer,
 * because a ride created exactly one thing, and this docstring said so: *"a
 * sheet holding a single row is a tap that asks a question with one answer"*,
 * and *"PD-402 is the story that makes a second action exist, and the sheet
 * shape becomes right on the day it lands rather than before it."* It landed. A
 * ride now creates a postcard tagged to it and a thread on it, so the sheet is
 * right and the furniture is no longer around an empty slot.
 *
 * **The rows come from `resolveRideDetailActions` rather than from here**, so
 * this bar and the timeline heading's `(+)` cannot offer different things — see
 * `RideCreateSheet`.
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
 * `private.is_ride_crew` to tag a postcard to a ride and `108` requires the same
 * helper to open a thread on one. A rider who defeats the control is refused by
 * the policy; a control the database always refuses is worse than no control at
 * all.
 */
export function RideCreateBar({ options }: { options: RideCreateOption[] }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="bottom-navbar fixed right-0 left-0 z-40 bg-background px-4 pt-4 pb-2">
        <div className="mx-auto max-w-lg">
          {/* `Create` rather than naming one act, matching `ClubCreateBar`: it
              opens a menu of two now, so a label naming either one would be
              wrong half the time. PD-401 shipped `Add a photo` precisely
              because there was only one destination to name. */}
          <Button size="md" className="text-base" onClick={() => setOpen(true)}>
            Create
          </Button>
        </div>
      </div>

      <RideCreateSheet options={options} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
