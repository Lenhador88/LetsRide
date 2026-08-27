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
 * ## Two variants, for the two places the strip can be in
 *
 * `variant="row"` is drawn where the strip would be, when the club has no
 * upcoming rides: full width, inset `mx-4`, with room for a subtitle.
 *
 * `variant="chip"` is appended **after** the last chip of a strip that has
 * some, so it scrolls with them and reads as the end of the list rather than a
 * second control competing with `See all`. Three things follow from sitting in
 * that strip, and all three are why it is not simply the row at a narrower
 * width:
 *
 * - **No `mx-4`.** The strip already supplies `px-4`; adding it would put a
 *   16px gap before a tile meant to sit one `gap-3` after the last ride.
 * - **`RideChip`'s internal geometry, not the row's.** `p-1` and a 48px leading
 *   tile, so the icon lands on the same x as a chip's date block. The row's
 *   `px-3` and bare 24px icon put it 8px off every neighbour.
 * - **No subtitle.** At 200px "Pick a date and a meeting point" truncates to a
 *   few characters and reads as damage rather than help.
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
        'flex h-14 items-center gap-3 rounded-lg border border-dashed border-border-strong bg-track text-left transition-colors active:bg-border',
        variant === 'chip' ? 'w-[200px] shrink-0 p-1' : 'mx-4 px-3'
      )}
    >
      {variant === 'chip' ? (
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-background"
        >
          <PlusCircleIcon className="h-6 w-6 text-muted" />
        </span>
      ) : (
        <PlusCircleIcon className="h-6 w-6 shrink-0 text-muted" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">Plan a ride</span>
        {variant === 'row' && (
          <span className="truncate text-xs font-medium text-muted">
            Pick a date and a meeting point
          </span>
        )}
      </span>
    </Link>
  )
}
