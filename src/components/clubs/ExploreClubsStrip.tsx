import Link from 'next/link'
import { ChevronRightIcon, LocationFilledIcon } from '@/components/icons/generated'
import { CLUBS_PAGE_SIZE } from '@/lib/data/clubs'

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
 * The pin is the approved frame's own glyph and stays; the *copy* deliberately
 * does not say "near you" until `PD-259` gives a club a location, since nothing
 * in the schema can back that sentence today.
 *
 * No button, deliberately: the Navbar's sticky `Create club` is already this
 * screen's one primary, and a second filled control beside it makes neither
 * read as the main action.
 */
export function ExploreClubsStrip({ count }: { count?: number }) {
  const label =
    count === undefined || count === 0
      ? 'Explore clubs'
      : count >= CLUBS_PAGE_SIZE
        ? `Explore ${CLUBS_PAGE_SIZE}+ clubs`
        : `Explore ${count} ${count === 1 ? 'club' : 'clubs'}`

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
