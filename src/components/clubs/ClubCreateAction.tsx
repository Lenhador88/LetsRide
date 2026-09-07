'use client'

import { useState } from 'react'
import { BikeIcon, ChatBubbleIcon, ImageIcon, PlusIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { FloatingAction } from '@/components/ui/FloatingAction'
import { routes } from '@/lib/routes'

/**
 * The club's create affordance — a floating action in the bottom-right corner,
 * opening the same three-row sheet the full-width bar opened (PD-404, Q1).
 *
 * **This was `ClubCreateBar` until 2026-09-06 and the rename is not cosmetic.**
 * That file's docstring was an argument about a *bar*: the `STICKY_ACTIONS`
 * approximation, the 358×40 primary the frame draws, and the deliberately
 * absent `border-t` "so the two read as one bar". Every one of those sentences
 * became false with the trigger, so they are gone rather than edited around —
 * a docstring describing a bar sitting on a circle is the comment trap
 * (`CLAUDE.md` §Technology Decisions) created on purpose. The history it
 * carried is in `docs/FIGMA-FIDELITY-TODO.md` §Club detail, which is also where
 * the departure this ships as is logged.
 *
 * ## Only the trigger moved
 *
 * The sheet below is untouched: three rows, the same order, the same icons, the
 * same `Create in this club` label, and the same club-scoped route on each — so
 * `backFromCreateScreen` and `CREATE_CLUB_PARAM` keep working without knowing
 * anything happened. The product owner asked for the shape (*"It should become
 * the same floating yes"*), not for a new sheet.
 *
 * **The club is the better fit for this pattern than the ride was**, which is
 * worth saying because the ride shipped first and reads as the reference: three
 * actions behind one `+` is the *expands into its actions* reference PD-404
 * opened with. The ride has two.
 *
 * ## The departure, and its size
 *
 * `2043:10604` instances `v2 / Component / Navigation / Bar` at 390×152 with
 * `Button Container 358×56` as a **child of that instance**, and 27 frames
 * instance the component at 152 — so this deletes a drawn child of a variant
 * **26 other frames share**. That is a different class from the ride's
 * departures, where `2375:8771` draws no create control at all and the floating
 * action was purely additive. Shipped as a recorded departure because route 1,
 * Figma-first, needs a Figma *write* that `CLAUDE.md` §Design System requires an
 * explicit owner ask for.
 *
 * ## Gating — unchanged, and still an affordance rather than the enforcement
 *
 * The caller draws this on the club detail's own `isMember`, the same expression
 * that drew the bar. `009`'s postcards INSERT policy and `017`'s rides INSERT
 * policy both require `private.is_club_member`, and `081` admits only members to
 * a club's threads, so all three destinations refuse a non-member — and a
 * control that always fails RLS is worse than no control. It reads no
 * `club_members.role`: `private.is_club_member` ignores it, and gating on it
 * would invent a hierarchy no policy has.
 *
 * A rider who defeats the control is refused by the policy.
 */
export function ClubCreateAction({ clubId }: { clubId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <FloatingAction
        // The CATEGORY, not an act. Arity is 3, so by the arity rule the control
        // opens the list and is named for what the list is about — a name for
        // any one row would be wrong two-thirds of the time. It is icon-only, so
        // this is the whole of what a screen reader gets, which is why it is not
        // a bare "Create": that says nothing about where the thing is created.
        label="Create in this club"
        icon={<PlusIcon className="h-6 w-6" aria-hidden="true" />}
        onClick={() => setOpen(true)}
      />

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
