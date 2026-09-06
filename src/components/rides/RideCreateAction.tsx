'use client'

import { useState } from 'react'
import { PlusIcon } from '@/components/icons/generated'
import { FloatingAction } from '@/components/ui/FloatingAction'
import { RideCreateSheet } from '@/components/rides/RideCreateSheet'
import type { RideCreateOption } from '@/types'

/**
 * The ride's create affordance — a floating action in the bottom-right corner,
 * opening the same sheet the full-width bar opened (PD-404).
 *
 * **This replaces `RideCreateBar`, which PD-401 shipped six days earlier**, and
 * the churn was the owner's call rather than a false start: PD-401 put the
 * entrance in the sticky slot because the `(+)` on a section heading was not an
 * affordance anyone found, and PD-404 changed the *shape* of that slot's
 * occupant after asking what the RSVP bar should do about it. The sheet, the
 * rows and the crew gate all survive unchanged; only the trigger moved.
 *
 * ## Why it can have the corner at all
 *
 * Because the RSVP bar is no longer there to fight it. PD-401's four options
 * all assumed the two controls coexist — stack them, alternate them, merge
 * them, or move the RSVP into the page body — and the owner's answer removed
 * the premise: answering the RSVP collapses that bar into a chip on the ride's
 * first content line, so the two are never drawn together.
 * `resolveRideDetailActions` is that decision and this component is only ever
 * mounted on its `create` arm.
 *
 * ## What it does NOT do, and the page has to
 *
 * `FloatingAction` reserves no vertical space — it floats over content, which
 * is the point of the pattern. **On this screen that is not acceptable on its
 * own**: the thing underneath is a timeline, so the last entry would sit
 * permanently under the button, which is one of the negative cases PD-404's
 * issue names by hand. The page opts into `.pb-floating-action-extra`
 * accordingly. The clearance is 80px against the old bar's 64px, so this costs
 * *more* vertical room than the bar did — **the gain here is horizontal**, and
 * anyone writing this up should not repeat the issue body's claim that a
 * floating action gives the screen's vertical space back.
 *
 * ## It is an affordance, never the enforcement
 *
 * The caller gates this on crew membership because `041` requires
 * `private.is_ride_crew` to tag a postcard to a ride and `108` requires the same
 * helper to open a thread on one. A rider who defeats the control is refused by
 * the policy; a control the database always refuses is worse than no control at
 * all.
 */
export function RideCreateAction({ options }: { options: RideCreateOption[] }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <FloatingAction
        // Names the sheet rather than one act, as `RideCreateBar`'s `Create`
        // label did and for the same reason: it opens a menu of two, so a name
        // for either one would be wrong half the time. It is icon-only, so this
        // is the whole of what a screen reader gets — hence "on this ride"
        // rather than a bare "Create", which says nothing about what is being
        // created or where.
        label="Create on this ride"
        icon={<PlusIcon className="h-6 w-6" aria-hidden="true" />}
        onClick={() => setOpen(true)}
      />
      <RideCreateSheet options={options} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
