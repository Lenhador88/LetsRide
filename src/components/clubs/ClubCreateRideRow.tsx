import Link from 'next/link'
import { PlusCircleIcon } from '@/components/icons/generated'
import { routes } from '@/lib/routes'

/**
 * The `Club rides` create affordance on the merged club detail
 * (`club-details-dropdown-removal`, PD-262) — a member's way to plan a ride in
 * this club. Fixed at 56px (`h-14`) to match `RideChip`'s own height, so the
 * section does not collapse to a bare line when it has nothing to scroll.
 *
 * ## One variant now, and it is the EMPTY one (PD-342)
 *
 * This row is drawn where the strip would be, when the club has no rides at
 * all: full width, inset `mx-4`, with room for a subtitle. A club that *has*
 * rides is added to from the `(+)` in the section heading instead — see
 * `SectionHeader`'s `create` prop.
 *
 * The 148px `variant="chip"` this file used to carry is gone with that change,
 * and the argument it was built to settle is gone with it. PD-312 put a create
 * tile **last** in the strip and reasoned it: *"the strip is ordered by
 * departure and the next ride is what a rider opened the club for, so a create
 * tile in that slot pushes it off-screen on every visit."* PD-318 reversed that
 * because the tile then fell off the right edge of a 390px screen with nothing
 * saying it was there — the product owner: *"I cannot create a ride in a club
 * if there are already rides. I dont see the create button??"* — and paid for
 * the slot by shrinking the tile to 148px. The heading pays for neither: it
 * costs the strip no width, so the next ride is first, and it is visible
 * without scrolling, which is the property PD-318 was protecting.
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
export function ClubCreateRideRow({ clubId }: { clubId: string }) {
  return (
    <Link
      href={routes.newRideInClub(clubId)}
      className="mx-4 flex h-14 items-center gap-3 rounded-lg border border-dashed border-border-strong bg-track px-3 text-left transition-colors active:bg-border"
    >
      <PlusCircleIcon className="h-6 w-6 shrink-0 text-muted" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">Plan a ride</span>
        <span className="truncate text-xs font-medium text-muted">
          Pick a date and a meeting point
        </span>
      </span>
    </Link>
  )
}
