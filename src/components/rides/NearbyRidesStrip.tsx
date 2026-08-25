import Link from 'next/link'
import { ChevronRightIcon, CloseIcon, LocationFilledIcon } from '@/components/icons/generated'
import type { NearLabel } from '@/lib/location/near-label'

/**
 * The row between the filter bar and the list: how many rides are happening
 * near you, and a tap to see only those — PD-260.
 *
 * Geometry is `ExploreClubsStrip`'s, deliberately: 56px on `White/100` at
 * radius 8, 16px padding, 12px gap, a 24px `Location Filled` in `Accent
 * Brand/100`, the label at Poppins/14/Semibold. The same row on two tabs should
 * be the same row. (Same caveat as that component's: the approved section was
 * written to Figma after the last `figma:pull`, so `npm run figma -- tree`
 * cannot confirm these numbers until the snapshot refreshes.)
 *
 * ## It is a filter, where the clubs strip is a door — and that changes when it
 * may hide
 *
 * `ExploreClubsStrip` must always render: it is the only route to
 * `/clubs/explore`, so hiding it at a zero count made a whole screen
 * unreachable, and that was withdrawn in review. **Nothing is behind this
 * one.** `/rides` already lists every ride the rider can see and there is no
 * `/rides/explore`, so a strip that draws nothing costs the rider no
 * destination — which is exactly the asymmetry PD-260 says this story does not
 * inherit from PD-258.
 *
 * So it hides in the two states where it could only mislead:
 *
 * - **No count yet** (`undefined`) — the position has not resolved, or the list
 *   has not landed. Drawing the row without a number would promise a filter
 *   that is not there yet, and drawing it *with* one would be inventing it.
 * - **Zero near** — `0 rides near you` is a row whose only function is to be
 *   tapped, that would strand the rider on an empty list. The clubs strip's
 *   rule against ever rendering a zero, arrived at from the other direction.
 *
 * **Except when the filter is already on**, which is the one state where it
 * must render regardless: it is then the only way back to the full list. A
 * near-set that empties under an active filter still draws the row, now reading
 * as the way out rather than the way in.
 */
export function NearbyRidesStrip({
  count,
  near,
  active,
  href,
}: {
  /**
   * How many rides are within `NEARBY_RADIUS_KM`. **`undefined` is "no answer
   * yet" and is not zero** — the rider's position is unresolved or the list has
   * not loaded — and the two draw differently, which is the whole reason this
   * is not a plain number.
   */
  count?: number
  /**
   * What to call the place the distances were measured FROM. Never the profile
   * city beside a device-measured distance — `nearLabel` owns that rule, and
   * `null` here means no position, so no claim of proximity at all.
   */
  near: NearLabel
  /** Is the near-you filter currently applied to the list below? */
  active: boolean
  /** Where the tap goes — the same URL with `near` added, or removed. */
  href: string
}) {
  // **The active branch renders unconditionally, and that is not symmetry — it
  // is the way out.** A rider can arrive on `?near=1` with no position at all
  // (a shared link, a reload after revoking permission, a profile city that
  // stops geocoding), and every other rule here would hide the row on exactly
  // that load, leaving an empty list with nothing on screen to un-filter it.
  // Off, the same states correctly draw nothing.
  if (!active) {
    // The number and the word move together, `ExploreClubsStrip`'s rule: a
    // count with no place to name states a proximity this screen cannot back
    // up.
    if (!near || count === undefined || count === 0) return null
  }

  // `you` rather than a name when there is nothing to name. It is what
  // `nearLabel` already answers for a device fix, so this is the same word the
  // rider saw when they turned the filter on rather than a second vocabulary.
  const place = near?.name ?? 'you'

  const label = active
    ? `Showing rides near ${place}`
    : count === 1
      ? `1 ride near ${place}`
      : `${count} rides near ${place}`

  return (
    // The padded wrapper is the component's own, not the page's, and that is
    // load-bearing rather than tidy: the page renders this in four places
    // including two early returns, and a wrapper out there would leave 8px of
    // padding above an error state in every case where the rules below draw
    // nothing.
    <div className="px-4 pt-2">
    <Link
      href={href}
      // `aria-pressed` is not available on a link, and this is genuinely a
      // navigation — the filter lives in the URL, so it is bookmarkable and the
      // back button undoes it. The label carries the state instead.
      className="flex h-14 items-center gap-3 rounded-lg bg-surface px-4 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:bg-background"
    >
      <LocationFilledIcon className="h-6 w-6 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{label}</span>
      {active ? (
        // A cross rather than a chevron: the tap now removes something instead
        // of leading somewhere, and a right-chevron on the active row reads as
        // "there is more through here" when there is not.
        <CloseIcon className="h-6 w-6 shrink-0 text-muted" />
      ) : (
        <ChevronRightIcon className="h-6 w-6 shrink-0 text-muted" />
      )}
      <span className="sr-only">{active ? 'Show all rides' : 'Show only these rides'}</span>
    </Link>
    </div>
  )
}
