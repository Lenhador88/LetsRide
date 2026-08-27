import Link from 'next/link'
import { PlusCircleIcon } from '@/components/icons/generated'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The `Club rides` create affordance on the merged club detail
 * (`club-details-dropdown-removal`, PD-262) — a member's way to plan a ride in
 * this club. Fixed at 56px (`h-14`) to match `RideChip`'s own height, so the
 * section does not collapse to a bare line when it has nothing to scroll.
 *
 * ## Two variants, for the two places the strip can be in
 *
 * `variant="row"` is drawn where the strip would be, when the club has no
 * rides at all: full width, inset `mx-4`, with room for a subtitle.
 *
 * `variant="chip"` is the **first** tile of a strip that has some, so it is
 * the first thing under the section header and scrolls away as the rider
 * moves through the rides. Two things follow from sitting in that strip:
 *
 * - **No `mx-4`.** The strip already supplies `px-4`; adding it would put a
 *   16px gap before a tile meant to sit flush with the section's own inset.
 * - **No subtitle.** At this width "Pick a date and a meeting point"
 *   truncates to a few characters and reads as damage rather than help.
 *
 * ## First, and 148px rather than `RideChip`'s 200 (PD-318)
 *
 * PD-312 put this tile **last** and reasoned it: *"the strip is ordered by
 * departure and the next ride is what a rider opened the club for, so a create
 * tile in that slot pushes it off-screen on every visit."* The reasoning was
 * sound and the outcome was worse than the state it replaced — on a 390px
 * screen a club with two or more rides pushed the tile entirely off the right
 * edge, with nothing on the page saying it was there. The product owner could
 * not find it at all: *"I cannot create a ride in a club if there are already
 * rides. I dont see the create button??"*
 *
 * **The width is what answers PD-312's objection rather than dismissing it.**
 * At 148px the tile costs 160px of the strip including its `gap-3`, so on the
 * narrowest phone this app targets the first ride chip still lands fully
 * inside 390px (16 + 148 + 12 + 200 = 376) with the second peeking. The
 * create tile no longer costs the rider their next ride, and it is the one
 * thing in the strip that never needs scrolling to.
 *
 * That width is why this variant does not carry `RideChip`'s 48px leading
 * date-block-shaped tile any more: it was there to align the icon on the same
 * x as a chip's date block, an argument that only held while this sat *after*
 * a chip. First in the strip, there is no chip to its left to align with, and
 * the 48px block plus `gap-3` left 64px for a label that needs ~78.
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
        variant === 'chip' ? 'w-[148px] shrink-0' : 'mx-4'
      )}
    >
      <PlusCircleIcon className="h-6 w-6 shrink-0 text-muted" aria-hidden="true" />
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
