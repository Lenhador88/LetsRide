import { LocationFilledIcon } from '@/components/icons/generated'

/**
 * The 358×160 map panel — decision #3, "a static thumbnail plus a Google Maps
 * deeplink", built as half of that.
 *
 * **The deeplink is real; the thumbnail is not.** `rides` carries no latitude or
 * longitude, only a free-text `meeting_point`, and Google's search endpoint
 * accepts a text query — so `Open in Google Maps` genuinely opens the meeting
 * point, while the panel behind it stays an empty container with a pin. Drawing
 * a fake map would be worse than an obviously empty one.
 *
 * Filling it needs a migration *and* a static-tile provider, which is two
 * decisions rather than a styling task. Registered in
 * docs/FIGMA-FIDELITY-TODO.md §Ride detail, the same way the rides list logged
 * its 80×148 image strip.
 */
export function RideMap({ meetingPoint }: { meetingPoint: string }) {
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meetingPoint)}`

  return (
    <div className="relative mx-4 h-40 overflow-hidden rounded-lg border border-border bg-border/40">
      <div className="flex h-full items-center justify-center" aria-hidden="true">
        <LocationFilledIcon className="h-6 w-6 text-muted" />
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-1 bottom-1 rounded bg-surface px-2 py-[3px] text-2xs font-medium text-foreground"
      >
        Open in Google Maps
      </a>
    </div>
  )
}
