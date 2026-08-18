'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EditIcon, LogOutIcon, OptionsIcon } from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { leaveClub } from '@/lib/actions/clubs'
import { routes } from '@/lib/routes'

/**
 * The club detail header's dots menu — `AI / Club detail merged / 2026-08-17`,
 * frames `4181:6897` (owner, Options open) and `4181:6930` (member, Options
 * open). Product owner, 2026-08-17: *"If owner we show the pencil, that also
 * goes to an option udner \[sic] the dots."* Replaces `ClubDetailPageMenu`'s
 * sub-page switcher in the header's `action` slot — the same move `RideHeader`
 * made when its own switcher was deleted (PD-254).
 *
 * Two rows only, by viewer role, and never both:
 *
 * - **Owner** → `Edit club`, into `routes.clubEdit`. What used to be the
 *   header's standalone pencil `Link`, now inside this sheet instead of beside
 *   it.
 * - **Member, not owner** (`admin` included — the role exists in `001`'s
 *   CHECK and carries no extra menu of its own) → `Leave club`, warning tone.
 *   This is where leaving lives now that `/clubs/detail/about` dissolves; it
 *   calls `leaveClub` directly rather than mounting `ClubMembershipButton`
 *   (a full-width `Button`, not a menu row) — the reused part is the *action*,
 *   not the component.
 *
 * A non-member gets no menu at all — the caller passes no `isOwner` in that
 * case and does not render this component, per `ClubDetailHeader`. An empty
 * sheet behind a dots icon would be worse than the icon's absence.
 *
 * **One deliberate deviation from the approved mock: no `Delete club` row.**
 * Both frames draw it under `Edit club`, and it is left out on purpose.
 * `ClubDetailHeader`'s own docstring and `design.md` §D4 (PD-101) already put
 * Delete at the foot of the edit screen behind a second tap, in
 * `DeleteClubControl` — the same call `DeleteRideControl` makes, and for the
 * same reason: siting one destructive control in two places is how it gets
 * tapped by accident. Not built here; the product owner settles it.
 *
 * **Join is not here either.** A non-member sees `ClubMembershipButton`
 * inline on the page instead — a constructive action stays visible, only the
 * destructive one is tucked away.
 */
export function ClubOptionsMenu({ clubId, isOwner }: { clubId: string; isOwner: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const showBanner = useBanner()
  const router = useRouter()

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
        {isOwner ? (
          <ContextMenuItem
            href={routes.clubEdit(clubId)}
            icon={<EditIcon className="h-6 w-6" />}
            onClick={() => setOpen(false)}
          >
            Edit club
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            icon={<LogOutIcon className="h-6 w-6" />}
            variant="warning"
            disabled={pending}
            onClick={onLeave}
          >
            Leave club
          </ContextMenuItem>
        )}
      </ContextMenu>
    </>
  )
}
