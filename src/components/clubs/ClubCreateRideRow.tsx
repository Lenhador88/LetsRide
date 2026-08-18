import Link from 'next/link'
import { PlusCircleIcon } from '@/components/icons/generated'

/**
 * The empty-`Upcoming rides` affordance on the merged club detail
 * (`club-details-dropdown-removal`, PD-262) — a member sees a way to plan the
 * club's first ride, drawn where the chip strip would otherwise scroll.
 * Fixed at 56px (`h-14`) to match `RideChip`'s own height, so the section
 * does not collapse to a bare line when it has nothing to scroll.
 *
 * ## Links to `/rides/new` unpreselected
 *
 * `CreateRideForm`'s club picker is a controlled `<select>` seeded from
 * `useState('')`, and `/rides/new` reads no query parameter that could carry
 * a club id — so this cannot land the rider on the form with this club
 * already chosen. Landing here and picking the club by hand is the honest
 * version of this affordance until the composer takes one; the same gap
 * `RideJournalEmpty`'s `Add` tile documents for the postcard composer.
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
export function ClubCreateRideRow() {
  return (
    <Link
      href="/rides/new"
      className="mx-4 flex h-14 items-center gap-3 rounded-lg border border-dashed border-border-strong bg-track px-3 text-left transition-colors active:bg-border"
    >
      <PlusCircleIcon className="h-6 w-6 shrink-0 text-muted" aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-foreground">Plan a ride</span>
        <span className="truncate text-xs font-medium text-muted">
          Pick a date and a meeting point
        </span>
      </span>
    </Link>
  )
}
