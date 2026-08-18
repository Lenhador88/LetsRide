import Link from 'next/link'
import { ChevronRightIcon, LocationFilledIcon } from '@/components/icons/generated'

/**
 * The row between the header and Your clubs — `AI / Clubs one screen /
 * 2026-08-17` (`4166:7017`), the section the product owner approved after
 * `ClubPageMenu` came out.
 *
 * Geometry read off that frame rather than chosen: 358×56 on `White/100` at
 * radius 8, 16px padding, 12px gap, a 24px `Location Filled` in `Accent
 * Brand/100`, the label at Poppins/14/Semibold, and a 24px `Chevron Right` in
 * `Grey/80`.
 *
 * **This is the only way to `/clubs/explore` now**, which is what shapes the
 * three states below rather than any visual preference. The sub-page dropdown
 * used to be the door and it was always there; a strip that hides on a bad day
 * strands a whole screen.
 *
 * - `count` **undefined** — the count read has not landed, or it failed. Draws
 *   `Explore clubs`, no number. A failed count must not cost the rider the
 *   route, so this deliberately does not distinguish "loading" from "errored":
 *   both mean *I cannot say how many, and you can still go and look*.
 * - `count` **0** — nothing to explore, so the row renders nothing at all. The
 *   one case where losing the door costs nothing, because the destination is
 *   an empty list.
 * - anything else — `Explore N clubs`, singular at one.
 *
 * No button, deliberately: the Navbar's sticky `Create club` is already this
 * screen's one primary, and a second filled control beside it makes neither
 * read as the main action.
 */
export function ExploreClubsStrip({ count }: { count?: number }) {
  if (count === 0) return null

  const label =
    count === undefined
      ? 'Explore clubs'
      : `Explore ${count} ${count === 1 ? 'club' : 'clubs'}`

  return (
    <Link
      href="/clubs/explore"
      className="flex h-14 items-center gap-3 rounded-lg bg-surface px-4 transition-colors active:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <LocationFilledIcon className="h-6 w-6 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {label}
      </span>
      <ChevronRightIcon className="h-6 w-6 shrink-0 text-muted" />
    </Link>
  )
}
