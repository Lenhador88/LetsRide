'use client'

import { useState } from 'react'
import { LocationFilledIcon } from '@/components/icons/generated'
import { cn, googleMapsDirectionsUrl } from '@/lib/utils'

/**
 * The 358×160 map panel — decision #3, "a static thumbnail plus a Google Maps
 * deeplink", and now both halves of it.
 *
 * **A tile REPLACES the panel's contents rather than sitting behind them.**
 * `051` added `rides.map_detail_path` and the data layer signs it into
 * `map_detail_url`; when a ride has one the panel draws what the Figma draws —
 * the map and the `Get directions` chip, and nothing else. The whole panel stays
 * the anchor — see the iPad note below, which was a real bug fix rather than a
 * decoration — and the deeplink is untouched.
 *
 * **The address is deliberately NOT drawn over the tile**, reversing task 3.3 on
 * the product owner's decision, 2026-08-12. 3.3 asked for it and the Figma panel
 * (`Ride - Ride plan (Details)` → `Map 358×160`) draws neither the address nor
 * the pin, carrying only `Map Container` and the chip. The page already renders
 * `meeting_point` in the `DetailRow` immediately above this panel, so keeping it
 * here bought a duplicate — and the price was a **70% full-panel scrim**, needed
 * only to hold that duplicate legible over unknown imagery, which darkened the
 * map badly enough to defeat the point of rendering one. Dropping the address
 * drops the scrim with it.
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
 * `Get directions` tap target this component exists to fix. **Top-left, on its
 * own `bg-scrim` pill** — it used to sit bottom-left in plain white, relying on
 * the full-panel scrim the address needed; with that gone it carries its own
 * bounded background, over ~120px rather than the whole tile. Top rather than
 * bottom because the bottom edge now belongs to the vendor's own credit and the
 * chip that had to move off it.
 *
 * **What is still owed here**, recorded rather than assumed: whether the
 * burned-in credit is legible at `RideCard`'s 80×148 strip. That is
 * `specs/ride-map-tiles`' *A credit that cannot fit means no tile* case, it
 * cannot be measured from a container with no route to the vendor, and it is
 * task 8.4's to answer against a real tile.
 *
 * **`bg-scrim` is still the instrument, but it now backs ~120px instead of the
 * whole panel.** `Grey/70%` bounds the composite at `#4C4C4C` however bright the
 * tile is — 8.59:1 for `White/100` at worst, measured, and better everywhere
 * else. That is what any text over unknown imagery needs, and after 3.3 was
 * reversed the only such text left is the Geoapify credit. **Do not reintroduce
 * a full-panel scrim** without also reintroducing something that needs it: the
 * darkening was never free, it was the cost of the address.
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
            // in the `DetailRow` immediately above this panel, and the whole
            // panel's `aria-label` names it again. Nothing here is the only
            // place that information appears, which is what makes an empty alt
            // correct rather than lazy.
            alt=""
            // Centred, which is the default and is now the right answer. This
            // was `object-right-bottom` for one reason only: Geoapify burned the
            // credit into the bottom-RIGHT, and this panel is *narrower* than
            // its 358-wide tile on most phones, so `object-cover` crops
            // HORIZONTALLY and truncated `© OpenStreetMap contributors`
            // mid-string at the two commonest mobile widths in the world:
            //
            //   430 → 398 panel, no horizontal crop
            //   390 → 358, none
            //   375 → 343, 15px cropped, 7.5px off the right   (iPhone SE 2/3, 6–8)
            //   360 → 328, 30px cropped, 15px off the right    (most Android)
            //   320 → 288, 70px cropped, 35px off the right    (iPhone SE 1)
            //
            // The crop is unchanged and the credit is gone — `ATTRIBUTION_MODE`
            // sends `attribution=none` and `MapAttribution` draws it in HTML
            // beneath this panel, where no crop can reach it. So the anchor is free to serve
            // the map again: centred keeps the meeting point in frame, which is
            // what the tile was rendered around, instead of pushing it toward a
            // corner to protect pixels that no longer exist.
            //
            // **The table stays because the crop stays.** If anything is ever
            // drawn into this tile's corners, those are the widths that eat it.
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setFailedTileUrl(tileUrl ?? null)}
            loading="lazy"
            draggable={false}
          />
        </>
      )}

      {/* **Keyed on the ride HAVING a tile, not on the tile currently drawing** —
          `tileUrl`, not `showsTile`, and that is the last step of PD-202 rather
          than a nicety.

          The render function now writes both tile paths or neither, so a ride
          with imagery on the rides list always has imagery here too and this
          credit always has a home. That closes the split at the source. What it
          does NOT close is `onError`: an expired signature or a 404 on THIS image
          drops `showsTile` while the card's tile is still on screen a tap away,
          and the Free-plan obligation is service-level rather than per-image — it
          is owed while the vendor's imagery is anywhere in the app, not only
          while this particular `<img>` succeeded.

          Rendered over the fallback panel in that case, which looks odd for a
          second and is the correct trade: the alternative is a credit that
          disappears exactly when a network is flaky. It carries its own
          `bg-scrim` pill, so it is legible on `bg-track` and over a tile alike —
          White/100 on the Grey/70% composite, 8.59:1 at worst.

          White/100 on a LOCAL pill, not the full-panel scrim this panel used to
          carry: that scrim existed to hold the ADDRESS legible over an unknown
          map, and with the address gone there is nothing left to darken the whole
          tile for. ~120px instead of the entire panel. */}
      {/* The pin and the address are the NO-TILE rendering, and only that.
          Over a tile the panel draws what the Figma draws — the map and the
          directions chip — because the address is already on screen in the
          `DetailRow` immediately above this panel, and holding a duplicate of it
          legible over unknown imagery is what cost the whole tile a 70% scrim.
          Product owner, 2026-08-12, reversing task 3.3. */}
      {!showsTile && (
        <>
          <LocationFilledIcon className="h-6 w-6 text-muted" aria-hidden="true" />
          {/* Grey/100 on Grey/10 is 12.65:1. `text-muted` here would be 4.17:1 —
              under the bar, and the exact failure docs/FIGMA-FIDELITY-TODO.md
              §Ride detail already logs twice for this screen. */}
          <span className="line-clamp-2 text-center text-sm font-medium text-foreground">
            {destination}
          </span>
        </>
      )}

      {/* **Bottom-LEFT over a tile, bottom-right without one, and that is an
          attribution constraint rather than a layout preference.** Geoapify
          burns the OpenStreetMap credit into the bottom-RIGHT of the image, and
          this chip is inset into exactly that corner — so over a tile it sits on
          top of the credit discharging obligation 1, the one with no plan-level
          escape. It was invisible while the panel carried a full-width scrim and
          a centred address; dropping those is what makes the tile's own corner
          legible and the collision real.
          UNMEASURED — the vendor's hosts are egress-blocked from the build
          container, so nobody has seen a real tile. Moved pre-emptively because
          the failure direction is a breached licence term, and task 8.4d
          confirms it against a real one. (Naming the host here is what the
          no-geoapify-key tripwire caught on the first draft of this comment —
          it scans prose too, deliberately.) */}
      <span
        className={cn(
          'absolute bottom-1 rounded bg-surface px-2 py-[3px] text-2xs font-medium text-foreground',
          showsTile ? 'left-1' : 'right-1'
        )}
      >
        Get directions
      </span>
    </a>
  )
}
