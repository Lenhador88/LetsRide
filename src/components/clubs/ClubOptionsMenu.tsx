'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DeleteIcon,
  EditIcon,
  LogOutIcon,
  OptionsIcon,
  PaperPlaneIcon,
  ProfileIcon,
} from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { DeleteClubSheet } from '@/components/clubs/DeleteClubControl'
import { leaveClub } from '@/lib/actions/clubs'
import { routes } from '@/lib/routes'
import { shareAppLink } from '@/lib/share'
import type { ClubDetail } from '@/types'

/**
 * The club detail header's dots menu — `AI / Club detail merged / 2026-08-17`,
 * frames `4181:6897` (owner, Options open) and `4181:6930` (member, Options
 * open). Product owner, 2026-08-17: *"If owner we show the pencil, that also
 * goes to an option udner \[sic] the dots."* Replaces `ClubDetailPageMenu`'s
 * sub-page switcher in the header's `action` slot — the same move `RideHeader`
 * made when its own switcher was deleted (PD-254).
 *
 * `Share club` for everyone who can open it, then one branch by viewer role:
 *
 * - **Share club** (PD-280) — the row every surface now has. `shareAppLink` is
 *   the postcard's own mechanism, extracted rather than reimplemented, and a
 *   recipient who is not signed in lands on the login screen (decision #1).
 * - **Owner** → `Edit club`, into `routes.clubEdit`. What used to be the
 *   header's standalone pencil `Link`, now inside this sheet instead of beside
 *   it — plus `Delete club` below it.
 * - **Owner or admin** → `Manage riders` (`088`, PD-326), into
 *   `routes.clubManage`. **This is the only entrance to that screen**, which is
 *   why the row is gated on the same disjunction the screen and
 *   `private.is_club_admin_for` both use — `viewer_is_owner || viewer_role ===
 *   'admin'`, never the role alone. PD-125 shipped a screen nobody could reach;
 *   an entrance drawn for the wrong set is the same defect one step down.
 * - **Member, not owner** (an `admin` also gets `Manage riders` above) →
 *   `Leave club`, warning tone.
 *   This is where leaving lives now that `/clubs/detail/about` dissolves; it
 *   calls `leaveClub` directly rather than mounting `ClubMembershipButton`
 *   (a full-width `Button`, not a menu row) — the reused part is the *action*,
 *   not the component.
 *
 * - **Non-member** → `Share club` and nothing else. This used to be no menu at
 *   all, because both remaining rows were a member's and an empty sheet behind
 *   a dots icon is worse than the icon's absence. `Share club` is precisely the
 *   row a non-member wants, so the sheet is no longer empty for them — and
 *   `Leave club` must not be offered to somebody who is not in the club, which
 *   is why this takes `viewerRole` rather than the `isOwner` boolean it used
 *   to: a two-state prop cannot tell a member from a stranger, and the false
 *   branch would have offered them Leave.
 *
 * **`Delete club` is BUILT as of PD-280, reversing this file's own deliberate
 * omission** — `docs/FIGMA-FIDELITY-TODO.md` §Club detail carries what was
 * argued and what the owner decided. The row opens `DeleteClubSheet` rather
 * than deleting, which is the general rule in
 * `docs/reference/design-system.md` §The ⋯ options menu.
 *
 * **Join is not here either.** A non-member sees `ClubMembershipButton`
 * inline on the page instead — a constructive action stays visible, only the
 * destructive one is tucked away.
 */
export function ClubOptionsMenu({
  clubId,
  viewerRole,
  isOwner,
}: {
  clubId: string
  /** The viewer's own `club_members.role`, or null for a non-member. */
  viewerRole: ClubDetail['viewer_role']
  /**
   * `ClubDetail.viewer_is_owner` — `clubs.owner_id`, NOT `viewer_role ===
   * 'owner'`. Two props for what looks like one question because the two
   * answers can differ: `043`'s `delete_owned_club` gates on the column, and an
   * owner who holds no roster row is a state `enforce-creator-membership` calls
   * reachable on demand. Gating the destructive row on the role would hide it
   * from the one owner who most needs it.
   */
  isOwner: boolean
}) {
  const isMember = viewerRole !== null
  // The same disjunction `ClubManageRidersPage` and `private.is_club_admin_for`
  // use. `viewer_is_owner` is the column on `clubs`, not the roster row, so an
  // owner holding no `club_members` row still gets the entrance (PD-280).
  const canManage = isOwner || viewerRole === 'admin'
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pending, startTransition] = useTransition()
  const showBanner = useBanner()
  const router = useRouter()

  async function onShare() {
    setOpen(false)
    const outcome = await shareAppLink(routes.club(clubId), 'A club on LetsRide')
    if (outcome === 'copied') showBanner('Link copied')
    if (outcome === 'unavailable') showBanner('This device would not share the link', 'error')
  }

  function onLeave() {
    setOpen(false)
    startTransition(async () => {
      const result = await leaveClub(clubId)
      if (result.error) {
        showBanner(result.error, 'error')
        return
      }
      showBanner('Left the club')
      // Leaving is the one action that can take the screen it was invoked from
      // away: the clubs SELECT policy is `is_public OR owner_id = auth.uid() OR
      // is_club_member(id)`, so for a private club the invalidated refetch
      // answers null and the page's `notFound()` fires — a success banner over
      // a Not Found. `replace` rather than `push`, so back does not return to
      // the club that just became unreadable.
      router.replace('/clubs')
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Club options"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-6 w-6" />
      </button>

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Club options">
        <ContextMenuItem icon={<PaperPlaneIcon className="h-6 w-6" />} onClick={onShare}>
          Share club
        </ContextMenuItem>

        {canManage && (
          <ContextMenuItem
            href={routes.clubManage(clubId)}
            icon={<ProfileIcon className="h-6 w-6" />}
            onClick={() => setOpen(false)}
          >
            Manage riders
          </ContextMenuItem>
        )}

        {isOwner ? (
          <>
            <ContextMenuItem
              href={routes.clubEdit(clubId)}
              icon={<EditIcon className="h-6 w-6" />}
              onClick={() => setOpen(false)}
            >
              Edit club
            </ContextMenuItem>

            {/* Its own group, as `ProfileMenu` separates Delete account from
                Sign out — a destructive row should not read as the next item in
                a list of ordinary ones. */}
            <div className="mt-2 border-t border-border pt-2">
              <ContextMenuItem
                icon={<DeleteIcon className="h-6 w-6" />}
                variant="warning"
                onClick={() => {
                  // Closed before the next opens — see `RideOptionsMenu` for
                  // why two `ContextMenu`s must not be open at once.
                  setOpen(false)
                  setDeleting(true)
                }}
              >
                Delete club
              </ContextMenuItem>
            </div>
          </>
        ) : (
          isMember && (
            <ContextMenuItem
              icon={<LogOutIcon className="h-6 w-6" />}
              variant="warning"
              disabled={pending}
              onClick={onLeave}
            >
              Leave club
            </ContextMenuItem>
          )
        )}
      </ContextMenu>

      <DeleteClubSheet clubId={clubId} open={deleting} onClose={() => setDeleting(false)} />
    </>
  )
}
