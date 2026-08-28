'use client'

import { useState } from 'react'
import {
  DeleteIcon,
  EditIcon,
  OptionsIcon,
  PaperPlaneIcon,
  ProfileIcon,
} from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { DeleteRideSheet } from '@/components/rides/DeleteRideControl'
import { routes } from '@/lib/routes'
import { shareAppLink } from '@/lib/share'

/**
 * The ride header's dots menu (PD-280) — the last main screen to get one.
 *
 * Product owner, 2026-08-24: *"the 3 dots sliding menu should apply for rides
 * and clubs… Seems like the same principle should be the app standard for these
 * main pages?"* It is: `ProfileMenu`, `ProfileDetailMenu`, `PostcardMenu` and
 * `ClubOptionsMenu` were already this exact shape, and the ride was the one
 * screen that had answered the question differently — a bare `EditIcon` link in
 * `secondaryAction`, with Delete reachable only from the foot of the edit
 * screen and no Share anywhere.
 *
 * **This supersedes `design.md` §D4's "Edit belongs in the header as a single
 * affordance".** That decision predates the club detail merge, which put Edit
 * behind the dots on the sibling screen and left the two inconsistent. Delete
 * still lives at the foot of the edit screen too — `DeleteRideControl` is
 * unchanged there — because a second route to it is fine and an only-route
 * nobody finds is what this fixes.
 *
 * Four rows, by viewer:
 *
 * - **Share ride** — anyone who can see the ride. New here; the app could not
 *   send a ride to anybody before this, which made a private ride organised for
 *   named riders impossible to actually invite them to. `shareAppLink` is the
 *   postcard's own mechanism, extracted rather than reimplemented.
 * - **Invite riders** — organizer only, into `routes.rideInvite` (`083`,
 *   PD-329). The in-app half of getting a named rider onto a ride, and the
 *   thing that makes a private ride organisable at all: before it, a ride
 *   reached people through a club they already belonged to or through
 *   `is_public`, and there was nothing in between.
 * - **Edit ride** — organizer only, into `routes.rideEdit`. What used to be the
 *   header's standalone pencil.
 * - **Delete ride** — organizer only, warning tone, opening `DeleteRideSheet`
 *   rather than deleting on a second tap. `ride-lifecycle` requires the
 *   confirmation to name the crew who lose the ride and the chat that goes with
 *   it, and a menu row has nowhere to say it.
 *
 * **A row is a display hint and never an authorization.** `isOrganizer` decides
 * what is drawn so the menu does not offer what the database will refuse;
 * `017`'s policies decide what happens. A rider who forges the state reaches
 * the same refusal they would by calling the action directly.
 */
export function RideOptionsMenu({
  rideId,
  isOrganizer,
}: {
  rideId: string
  /** `undefined` while the ride is still being read — see `RideHeader`. */
  isOrganizer: boolean | undefined
}) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const showBanner = useBanner()

  async function onShare() {
    setOpen(false)
    const outcome = await shareAppLink(routes.ride(rideId), 'A ride on LetsRide')
    if (outcome === 'copied') showBanner('Link copied')
    if (outcome === 'unavailable') showBanner('This device would not share the link', 'error')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Ride options"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-6 w-6" />
      </button>

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Ride options">
        <ContextMenuItem icon={<PaperPlaneIcon className="h-6 w-6" />} onClick={onShare}>
          Share ride
        </ContextMenuItem>

        {isOrganizer && (
          <>
            {/* `083`, PD-329. Organizer only, and ABSENT rather than disabled
                for everyone else — the row is a display hint and `083`'s INSERT
                policy is the enforcement, so what this owes is not to offer
                what the database will refuse. `ProfileIcon` is the nearest
                glyph the generated set has; there is no "add rider" one, the
                same gap PD-250 records for postcards. */}
            <ContextMenuItem
              href={routes.rideInvite(rideId)}
              icon={<ProfileIcon className="h-6 w-6" />}
              onClick={() => setOpen(false)}
            >
              Invite riders
            </ContextMenuItem>

            <ContextMenuItem
              href={routes.rideEdit(rideId)}
              icon={<EditIcon className="h-6 w-6" />}
              onClick={() => setOpen(false)}
            >
              Edit ride
            </ContextMenuItem>

            {/* Its own group, as `ProfileMenu` separates Delete account from
                Sign out — the destructive row should not read as the next item
                in a list of ordinary ones. */}
            <div className="mt-2 border-t border-border pt-2">
              <ContextMenuItem
                icon={<DeleteIcon className="h-6 w-6" />}
                variant="warning"
                onClick={() => {
                  // Closed before the next opens: both render through the same
                  // fixed z-index stack, and `ContextMenu`'s focus trap assumes
                  // it is the only one mounted open at once.
                  setOpen(false)
                  setDeleting(true)
                }}
              >
                Delete ride
              </ContextMenuItem>
            </div>
          </>
        )}
      </ContextMenu>

      <DeleteRideSheet rideId={rideId} open={deleting} onClose={() => setDeleting(false)} />
    </>
  )
}
