import Link from 'next/link'
import { ChevronRightIcon, LocationFilledIcon } from '@/components/icons/generated'
import { CLUBS_PAGE_SIZE } from '@/lib/data/clubs'
import type { NearLabel } from '@/lib/location/near-label'

/**
 * The row between the header and Your clubs — `AI / Clubs one screen /
 * 2026-08-17` (`4166:7017`), the section the product owner approved after
 * `ClubPageMenu` came out.
 *
 * Geometry read off that frame rather than chosen: 358×56 on `White/100` at
 * radius 8, 16px padding, 12px gap, a 24px `Location Filled` in `Accent
 * Brand/100`, the label at Poppins/14/Semibold, and a 24px `Chevron Right` in
 * `Grey/80`. **That frame was written to Figma after the last `figma:pull`, so
 * it is not in `design/` yet** — `npm run figma -- tree` cannot confirm these
 * numbers until the snapshot is refreshed. Same state as `PD-254`'s section.
 *
 * **This is the only way to `/clubs/explore` now, so it always renders.** The
 * sub-page dropdown it replaces sat on the header, outside every read gate, and
 * was therefore reachable even on a screen whose list had failed to load. The
 * first version of this component returned `null` at a zero count and was
 * rendered inside the list's gate; both were withdrawn in review, because
 * together they made the route unreachable whenever `getYourClubs` errored.
 *
 * **A zero count is not evidence that there is nothing to explore**, which is
 * the other half of that withdrawal. `getExploreClubs` reads the newest
 * `CLUBS_PAGE_SIZE` public clubs and *then* drops the ones this rider has
 * joined, so a rider who is in all fifty of the newest gets an empty array
 * while older unjoined clubs exist. So zero draws the label without a number
 * rather than hiding the row.
 *
 * The number is bounded by that same page, which is why it reads `50+` at the
 * cap: `Explore 50 clubs` against a database of five hundred is a total the
 * rider has no reason to doubt. It is still exactly `explore.data.length` —
 * the same array `/clubs/explore` renders, under the same cache key — because
 * a count that can disagree with the list one tap away is `PD-254`'s crew-count
 * bug, and no server-side `count` can reproduce a predicate applied in JS.
 *
 * **`near` is now TRUE rather than decorative, and PD-259 is what changed
 * that.** This row shipped saying `near Utrecht` while `getExploreClubs` had no
 * geographic predicate of any kind — a deliberate, recorded gap, because
 * `clubs` had no location column to filter on. `066` gave it one, so the word
 * is now backed by a measured distance: `nearCount` is how many of the clubs in
 * the list are within `NEARBY_RADIUS_KM` of the rider.
 *
 * **The number and the word move together, and that coupling is the whole
 * rule.** `near <name>` is drawn only when there is a place to name AND at
 * least one club is actually near it; the count beside it is then the NEAR
 * count, not the total. Any other pairing states something false — `Explore 12
 * clubs near Utrecht` with eleven of them in Groningen is worse than the honest
 * `Explore 12 clubs`, because a rider cannot tell it is wrong until they tap.
 *
 * **And the destination shows that same near set FIRST, under that same
 * name.** `ExploreClubsList` draws a `Near <name>` heading over exactly the
 * clubs counted here, which is what keeps PD-258's second trap closed: the
 * number the rider taps is the number they land on. A version of this that
 * counted the near ones while the destination listed all of them was caught in
 * review, and it is the same defect as PD-254's crew count in a new shape.
 *
 * **The name comes from `nearLabel`, never from the profile city directly.**
 * The distance is measured from `resolveRiderLocation()`, whose first source is
 * the device — so naming `profiles.location` beside it says `near Utrecht`
 * about clubs measured from Maastricht. `nearLabel` is the one thing that reads
 * `RiderLocation.source`, and it answers `you` whenever the name would not
 * match the number. Product owner, 2026-08-18: *"just close by city or village
 * or town is fine. remove the country."*
 *
 * **A zero near-count falls back to the unfiltered total rather than to zero.**
 * PD-258's first trap, and it is sharper now than when it was written: this row
 * is the only door to `/clubs/explore`, so a rider with no club within 100 km
 * must still be told how many there are to explore. Nothing here may ever
 * render `Explore 0 clubs` while public clubs exist.
 *
 * The pin is the approved frame's own glyph.
 *
 * No button, deliberately: the Navbar's sticky `Create club` is already this
 * screen's one primary, and a second filled control beside it makes neither
 * read as the main action.
 */
export function ExploreClubsStrip({
  count,
  nearCount,
  near,
}: {
  count?: number
  /**
   * How many of `count` are within `NEARBY_RADIUS_KM`. `undefined` means the
   * question has no answer yet — the rider's position has not resolved, or the
   * list has not loaded — which is NOT the same as zero and must not read as it.
   */
  nearCount?: number
  /** What to call where the distances were measured from — see `nearLabel`. */
  near?: NearLabel
}) {
  // The word and the number are chosen together. `near <name>` needs a name AND
  // at least one club actually near it; without both, the row falls back to the
  // unfiltered total with no place clause — never to a zero.
  const sayNear = !!near && nearCount !== undefined && nearCount > 0
  const shown = sayNear ? nearCount : count
  const place = sayNear ? ` near ${near!.name}` : ''

  const label =
    shown === undefined || shown === 0
      ? `Explore clubs${place}`
      : shown >= CLUBS_PAGE_SIZE
        ? `Explore ${CLUBS_PAGE_SIZE}+ clubs${place}`
        : `Explore ${shown} ${shown === 1 ? 'club' : 'clubs'}${place}`

  return (
    <Link
      href="/clubs/explore"
      className="flex h-14 items-center gap-3 rounded-lg bg-surface px-4 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:bg-background"
    >
      <LocationFilledIcon className="h-6 w-6 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{label}</span>
      <ChevronRightIcon className="h-6 w-6 shrink-0 text-muted" />
    </Link>
  )
}
