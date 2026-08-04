import { LocationFilledIcon } from '@/components/icons/generated'
import { googleMapsDirectionsUrl } from '@/lib/utils'

/**
 * The 358×160 map panel — decision #3, "a static thumbnail plus a Google Maps
 * deeplink", built as half of that.
 *
 * **The deeplink is real; the thumbnail is not.** `rides` carries no latitude or
 * longitude, so there is no tile to draw. Filling it needs a migration *and* a
 * keyed static-tile provider, which is two product decisions rather than a
 * styling task; registered in docs/FIGMA-FIDELITY-TODO.md §Ride detail.
 *
 * What the panel does instead is be honest about what it is: the meeting point,
 * legibly, and one obvious tap that opens directions to it. Three things about
 * the first version of this were reported from a real iPad and are fixed here:
 *
 * - **It read as blank, and not only on an iPad — everywhere.** The fill was
 *   `bg-border/40`, which compiles to `#0000000a`: 4% black, `#e9e3dd` once
 *   composited over the cream background, **1.09:1 against the page it sits
 *   on**. An empty container that close to its own background is not a panel,
 *   it is nothing. (The first draft of this comment blamed Safari's
 *   `color-mix()` support instead. That was wrong and was checked rather than
 *   trusted: the production build emits a static `#0000000a` *outside* the
 *   `@supports` guard, so a browser with no `color-mix()` still gets the fill.
 *   The bug was never browser-specific.)
 *   `bg-track` — the opaque `Grey/10` this screen already uses for its hairlines
 *   and RSVP track — is 1.17:1 against the page, which is honestly still a quiet
 *   surface. What actually makes the panel read now is that it *contains*
 *   something: the address at 12.65:1 on that fill, and a white chip.
 * - **Only a 100×20 chip was tappable.** The panel looked like the target and
 *   was not. The whole 358×160 is the link now, which is also what makes it a
 *   glove-sized target rather than a precise one.
 * - **It carried no information.** An empty box with a pin says less than the
 *   address does, and the address is the thing a rider actually reads.
 *
 * The chip stays a `<span>`: the panel is already an anchor and nesting a second
 * interactive element inside one is invalid HTML that browsers resolve by
 * closing the outer link early.
 */
export function RideMap({ meetingPoint }: { meetingPoint: string }) {
  const destination = meetingPoint.trim()

  // `meeting_point` is NOT NULL but not non-empty, and a blank destination
  // deeplinks to an empty Google Maps route form — an affordance that visibly
  // does nothing is worse than no affordance.
  if (!destination) {
    return (
      <div
        className="relative mx-4 flex h-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-track"
        aria-hidden="true"
      >
        <LocationFilledIcon className="h-6 w-6 text-muted" />
      </div>
    )
  }

  return (
    <a
      href={googleMapsDirectionsUrl(destination)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Get directions to ${destination}`}
      className="relative mx-4 flex h-40 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-border bg-track px-6"
    >
      <LocationFilledIcon className="h-6 w-6 text-muted" aria-hidden="true" />
      {/* Grey/100 on Grey/10 is 12.65:1. `text-muted` here would be 4.17:1 —
          under the bar, and the exact failure docs/FIGMA-FIDELITY-TODO.md
          §Ride detail already logs twice for this screen. */}
      <span className="line-clamp-2 text-center text-sm font-medium text-foreground">
        {destination}
      </span>
      <span className="absolute right-1 bottom-1 rounded bg-surface px-2 py-[3px] text-2xs font-medium text-foreground">
        Get directions
      </span>
    </a>
  )
}
