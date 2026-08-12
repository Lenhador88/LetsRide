'use client'

import { useState } from 'react'
import { LocationFilledIcon } from '@/components/icons/generated'
import { cn, googleMapsDirectionsUrl } from '@/lib/utils'

/**
 * The 358×160 map panel — decision #3, "a static thumbnail plus a Google Maps
 * deeplink", and now both halves of it.
 *
 * **The tile goes behind the existing content; it does not replace it.** `051`
 * added `rides.map_detail_path` and the data layer signs it into
 * `map_detail_url`, so when a ride has a tile the panel draws it under the
 * address and the `Get directions` chip. The whole panel stays the anchor — see
 * the iPad note below, which was a real bug fix rather than a decoration — and
 * the deeplink is untouched.
 *
 * **No tile is the ordinary state and it is the state of every ride today.**
 * Nothing writes `map_detail_path` until the render function ships, and an
 * address that never resolves keeps a NULL path for ever, so the fallback below
 * is not a degraded rendering — it is the rendering. A tile that fails to load
 * returns to it exactly.
 *
 * **The address needs a scrim over a tile and does not over `bg-track`.** Grey/100
 * on the opaque `Grey/10` fill is 12.65:1; over an arbitrary map it is whatever
 * the map happens to be under those two lines. `bg-scrim` — the `Grey/70%` this
 * design system already uses to put text on a photo — bounds the composite at
 * `#4D4D4D` however bright the tile is, which is 8.0:1 for `White/100` at worst
 * and better everywhere else. It costs the tile some brightness, and that is the
 * trade: the address is the one thing on this panel a rider actually reads.
 *
 * What the panel does when there is no tile is be honest about what it is: the
 * meeting point, legibly, and one obvious tap that opens directions to it. Three
 * things about the first version of this were reported from a real iPad and are
 * fixed here:
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
export function RideMap({
  meetingPoint,
  tileUrl,
}: {
  meetingPoint: string
  /**
   * The signed URL of this ride's 358×160 tile, or null when it has none —
   * which is every ride today. Never a Storage path: the data layer owns
   * signing, per viewer, and a path is not something this component could
   * render.
   */
  tileUrl?: string | null
}) {
  const destination = meetingPoint.trim()

  // A tile that 404s or whose signature has expired falls back to the panel
  // this screen has always drawn, rather than leaving a broken image under the
  // address.
  const [tileFailed, setTileFailed] = useState(false)
  const showsTile = !!tileUrl && !tileFailed

  // `meeting_point` is NOT NULL but not non-empty, and nothing rejects blank:
  // the create form's `required` accepts `"   "`, the insert does not trim,
  // there is no Zod schema for ride creation, and 001 set no check constraint.
  //
  // Renders nothing rather than an empty panel. The page above already made
  // this exact call for the 200px banner — "it carries no affordance at all,
  // so an empty fifth of the screen is worse than a shorter page" — and a
  // 160px box with a decorative pin and no link is the same object. Drawing
  // one here while omitting the banner for the stated reason would have been
  // the page contradicting itself.
  if (!destination) return null

  return (
    <a
      href={googleMapsDirectionsUrl(destination)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Get directions to ${destination}`}
      className="relative mx-4 flex h-40 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-border bg-track px-6"
    >
      {showsTile && (
        <>
          {/* A signed URL that expires hourly — see PostcardCard for why this is
              a bare img rather than next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tileUrl ?? undefined}
            // Decorative: the meeting point this tile is centred on is written
            // over it, and again in the location row above the panel.
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setTileFailed(true)}
            loading="lazy"
            draggable={false}
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-scrim" />
        </>
      )}

      {/* `relative` only over a tile, and only so the content paints above an
          absolutely-positioned sibling. Without a tile these two are exactly
          what this panel has always rendered. */}
      <LocationFilledIcon
        className={cn('h-6 w-6', showsTile ? 'relative text-white' : 'text-muted')}
        aria-hidden="true"
      />
      {/* Grey/100 on Grey/10 is 12.65:1. `text-muted` here would be 4.17:1 —
          under the bar, and the exact failure docs/FIGMA-FIDELITY-TODO.md
          §Ride detail already logs twice for this screen. Over a tile the fill
          is unknown, so the pairing becomes White/100 on `bg-scrim` — see the
          header. */}
      <span
        className={cn(
          'line-clamp-2 text-center text-sm font-medium',
          showsTile ? 'relative text-white' : 'text-foreground'
        )}
      >
        {destination}
      </span>
      <span className="absolute right-1 bottom-1 rounded bg-surface px-2 py-[3px] text-2xs font-medium text-foreground">
        Get directions
      </span>
    </a>
  )
}
