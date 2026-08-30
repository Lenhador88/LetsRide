import Link from 'next/link'
import { ChevronRightIcon, LocationFilledIcon } from '@/components/icons/generated'
import type { NearLabel } from '@/lib/location/near-label'

/**
 * The row between the filter bar and the list: the way to `/rides/explore`.
 *
 * Geometry is `ExploreClubsStrip`'s, deliberately: 56px on `White/100` at
 * radius 8, 16px padding, 12px gap, a 24px `Location Filled` in `Accent
 * Brand/100`, the label at Poppins/14/Semibold, a 24px `Chevron Right` in
 * `Grey/80`. The same row on two tabs should be the same row. (Same caveat as
 * that component's: the approved section was written to Figma after the last
 * `figma:pull`, so `npm run figma -- tree` cannot confirm these numbers until
 * the snapshot refreshes.)
 *
 * ## It was a filter and it is a door now
 *
 * This shipped as `NearbyRidesStrip` (PD-260) — a toggle that added `?near=1`
 * to the rides list and filtered the rows already on screen. Its own header
 * recorded the asymmetry that justified the difference: *"Nothing is behind
 * this one. `/rides` already lists every ride the rider can see and there is no
 * `/rides/explore`."* Both halves of that stopped being true on 2026-08-27 —
 * the tab is the rider's clubs now, and there is a screen behind this row — so
 * the component became the thing it was contrasted against.
 *
 * Three consequences follow from that single change, and each one inverts a
 * rule the filter version had:
 *
 * - **It always renders**, where the filter hid itself at a zero count.
 *   `ExploreClubsStrip` learned this the hard way and the reasoning transfers
 *   whole: this is the only route to `/rides/explore`, so a row that hides is a
 *   screen that cannot be reached. There is no navbar entry and no link
 *   anywhere else.
 * - **It carries no number**, where the filter's whole content was one. Product
 *   owner, 2026-08-27, giving the string directly: *"Explore public rides near
 *   Hoorn"*. A count here would also be the weaker claim — it is bounded by
 *   `getExploreRides`'s page, so `Explore 30 rides` against a database of three
 *   hundred understates by an order of magnitude with no way for a rider to
 *   tell.
 * - **There is no active state**, because there is nothing to turn off. The
 *   filter needed a cross and an "already on" branch that rendered
 *   unconditionally as the way out; a door needs neither.
 *
 * ## `near <place>` is still earned, not decorative
 *
 * The word is drawn only when there is a place to name AND at least one ride
 * behind this row is actually within `NEARBY_RADIUS_KM` of it. That pairing is
 * `ExploreClubsStrip`'s rule and it survives the loss of the number intact —
 * arguably it matters more without one, since `Explore public rides near Hoorn`
 * over a screen with nothing near Hoorn is a promise a rider cannot check until
 * they tap. `ExploreRidesList` draws its `Near <name>` section from the same
 * array under the same cache key, so the two agree by construction.
 *
 * No button, deliberately: the Navbar's sticky `Create ride` is already this
 * screen's one primary, and a second filled control beside it makes neither
 * read as the main action.
 */
export function ExploreRidesStrip({
  near,
  nearCount,
}: {
  /**
   * What to call the place distances were measured FROM — never the profile
   * city beside a device-measured distance. `nearLabel` owns that rule, and
   * `null` means no position, so no claim of proximity at all.
   */
  near: NearLabel
  /**
   * How many rides behind this row are within `NEARBY_RADIUS_KM`. **`undefined`
   * is "no answer yet" and is not zero** — the position has not resolved, or
   * the explore read has not landed — and neither may say `near <place>`, so
   * the two collapse here where they would not in a component that drew a
   * count.
   */
  nearCount?: number
}) {
  const sayNear = !!near && nearCount !== undefined && nearCount > 0
  const label = sayNear ? `Explore public rides near ${near!.name}` : 'Explore public rides'

  return (
    // The padded wrapper is the component's own rather than the page's, kept
    // from the filter version for the same reason it had it: the page renders
    // this above its read gates, including two early returns, and a wrapper out
    // there would leave 8px of padding above an error state.
    <div className="px-4 pt-2">
      <Link
        href="/rides/explore"
        className="flex h-14 items-center gap-3 rounded-lg bg-surface px-4 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:bg-background"
      >
        <LocationFilledIcon className="h-6 w-6 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {label}
        </span>
        <ChevronRightIcon className="h-6 w-6 shrink-0 text-muted" />
      </Link>
    </div>
  )
}
