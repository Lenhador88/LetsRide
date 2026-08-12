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
 * **Attribution — PD-104 §6.1, and there are two obligations, not one.**
 *
 * 1. **OpenStreetMap, required always.** Geoapify's terms make it unconditional —
 *    *"When using the Services, you must always provide OpenStreetMap
 *    attribution"* — so no plan upgrade removes it. The Static Maps response
 *    **burns that credit into the image**, bottom-right, and that is what
 *    discharges it. Nothing here suppresses it, and `object-right-bottom` below
 *    is what stops `object-cover` cropping it off. **Both axes crop, in opposite
 *    directions**: the panel is wider than the 358 tile above 390 and *narrower*
 *    below it, so a bottom-only anchor still truncated the credit mid-string at
 *    375 and 360 — the two commonest mobile widths. See the table at the tag.
 * 2. **`Powered by Geoapify`, mandatory on the Free plan** — the plan this
 *    account is on, confirmed by the product owner 2026-08-11. That one is a
 *    *service*-level obligation rather than a property of the tile's data, so it
 *    takes a single legible home rather than riding on every tile; this panel is
 *    it, because it is the screen where a rider actually looks at a map.
 *
 * Plain text and not the documented `Powered by <a …>Geoapify</a>`, because the
 * whole panel is already an anchor and nesting one inside another is invalid HTML
 * that browsers resolve by closing the outer link early — which would cost the
 * `Get directions` tap target this component exists to fix. Bottom-**left**, so
 * it is clear of the `Get directions` chip inset bottom-right.
 *
 * **What is still owed here**, recorded rather than assumed: whether the
 * burned-in credit is legible at `RideCard`'s 80×148 strip. That is
 * `specs/ride-map-tiles`' *A credit that cannot fit means no tile* case, it
 * cannot be measured from a container with no route to the vendor, and it is
 * task 8.4's to answer against a real tile.
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
  // Keyed on the URL that failed, NOT a boolean latch — same reason as
  // RideCard: this component survives the refetch that re-mints the signed URL,
  // so a boolean would keep the panel on its fallback for the rest of the mount
  // after a single expiry.
  const [failedTileUrl, setFailedTileUrl] = useState<string | null>(null)
  const showsTile = !!tileUrl && tileUrl !== failedTileUrl

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
            // `object-right-bottom`, not the default centre and NOT
            // `object-bottom`. The tile is 358×160 and this panel is the page
            // width less 32, with no `max-w` anywhere in the layout — so the
            // panel is *narrower* than the tile on most phones and `object-cover`
            // crops HORIZONTALLY, which `object-bottom` (`50% 100%`) does nothing
            // about because it only moves the vertical axis:
            //
            //   430 → 398 panel, no horizontal crop
            //   390 → 358, none
            //   375 → 343, 15px cropped, 7.5px off the right   (iPhone SE 2/3, 6–8)
            //   360 → 328, 30px cropped, 15px off the right    (most Android)
            //   320 → 288, 70px cropped, 35px off the right    (iPhone SE 1)
            //
            // Geoapify burns the credit bottom-RIGHT, so on the two commonest
            // mobile widths in the world `© OpenStreetMap contributors` was being
            // truncated mid-string. Obligation 1 has no plan-level escape and
            // §6.2 forbids resolving it by truncating the vendor's name.
            // Anchoring bottom-right pins the credit's own corner and moves the
            // whole crop to the top and left, where nothing is owed.
            className="absolute inset-0 h-full w-full object-cover object-right-bottom"
            onError={() => setFailedTileUrl(tileUrl ?? null)}
            loading="lazy"
            draggable={false}
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-scrim" />
          {/* White/100 on `bg-scrim` — the same 8.0:1 floor the address above
              gets, since the scrim covers the whole panel. After the scrim in
              DOM order so it paints above it, and before the chip so the chip
              still paints above this. */}
          <span className="pointer-events-none absolute bottom-1 left-1 text-2xs font-medium text-white">
            Powered by Geoapify
          </span>
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
