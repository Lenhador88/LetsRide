import Link from 'next/link'
import { PlusCircleIcon } from '@/components/icons/generated'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The `Upcoming rides` create affordance on the merged club detail
 * (`club-details-dropdown-removal`, PD-262) — a member's way to plan a ride in
 * this club. Fixed at 56px (`h-14`) to match `RideChip`'s own height, so the
 * section does not collapse to a bare line when it has nothing to scroll.
 *
 * ## Two variants, because it is now drawn in two places (PD-312)
 *
 * It began as the **empty** state only, and that left a club with one ride
 * offering no way to plan a second: the strip filled up and the affordance
 * disappeared with it, so the only route on was `See all` and a control on
 * another screen. Product owner, 2026-08-27 — *"I am missing a button to create
 * a new ride on the upcoming ride list."*
 *
 * `variant="row"` is the original: full width, inset `mx-4`, drawn where the
 * strip would be. `variant="chip"` is the same affordance sized as a
 * `RideChip` (`w-[200px]`) and appended **after** the last chip, so it scrolls
 * with them and reads as the end of the list rather than a second control. It
 * carries no `mx-4` — the strip already supplies `px-4`, and adding it would
 * put a 16px gap before a tile that is meant to sit one gap after the last
 * ride.
 *
 * ## Carries the club, both ways (PD-283)
 *
 * `routes.newRideInClub` puts the id in the URL, which seeds the composer's
 * club `<select>` and is what its back control resolves to — so a rider who
 * plans a ride from here is not asked which club, and lands back in this club
 * rather than on the Rides tab. `src/lib/routes.ts` §`CREATE_CLUB_PARAM` has
 * why this is an id rather than `back-navigation.ts`'s path.
 *
 * The id is a hint. `017`'s rides INSERT policy still decides, and
 * `seedClubId` refuses an id that is not one of the rider's own clubs — see
 * that module for why an unmatched value is worse than none.
 *
 * ## Gated by the caller, not here
 *
 * Whether to render this row at all is `/clubs/detail`'s call, on
 * `club.viewer_role` — the same membership `017`'s `rides` INSERT policy
 * actually requires (`club_id is null or private.is_club_member(club_id)`).
 * `viewer_role` is a display hint rather than an authorization signal (see
 * `ClubDetail`'s own docstring); a rider who defeats this gate still meets
 * the real one at the database.
 */
export function ClubCreateRideRow({
  clubId,
  variant = 'row',
}: {
  clubId: string
  variant?: 'row' | 'chip'
}) {
  return (
    <Link
      href={routes.newRideInClub(clubId)}
      className={cn(
        'flex h-14 items-center gap-3 rounded-lg border border-dashed border-border-strong bg-track px-3 text-left transition-colors active:bg-border',
        variant === 'chip' ? 'w-[200px] shrink-0' : 'mx-4'
      )}
    >
      <PlusCircleIcon className="h-6 w-6 shrink-0 text-muted" aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-foreground">Plan a ride</span>
        {/* Dropped in the chip, kept in the row. At 200px the subtitle
            truncates to a few characters and reads as damage rather than as
            help; the row has the full width to say it. */}
        {variant === 'row' && (
          <span className="truncate text-xs font-medium text-muted">
            Pick a date and a meeting point
          </span>
        )}
      </span>
    </Link>
  )
}
