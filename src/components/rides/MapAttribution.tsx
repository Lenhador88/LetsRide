import { cn } from '@/lib/utils'

/**
 * The map credit, in HTML, because the tile no longer carries one.
 *
 * **This component and `ATTRIBUTION_MODE` in
 * `supabase/functions/resolve-ride-location/gates.ts` are two halves of one
 * obligation.** That constant sends `attribution=none`, so the Static Maps
 * response comes back with nothing burned into the image; this is where the
 * credit it removed gets paid. Geoapify's own instruction is explicit that the
 * swap is the caller's to honour — *"you need to care about attributions
 * yourself when you hide the automatically added attribution"* — and their
 * guidance names exactly this placement: *"the credit should typically appear
 * in the corner of the map, as commonly seen with map APIs/libraries such as
 * Leaflet, MapLibre, OpenLayers."*
 *
 * **Neither half may ship without the other, and the order matters in one
 * direction only.** The app gaining a credit while the image still burns one in
 * is a harmless duplicate for the length of a deploy. The image losing its
 * credit while the app has none is a breach. So this merges first and the
 * function is redeployed after it is serving — never the reverse.
 *
 * ## The three strings, and which of them is conditional
 *
 * Quoted exactly as Geoapify writes them, because two of them are licence text
 * rather than prose and paraphrasing them is what makes a credit stop counting:
 *
 * 1. **`© OpenStreetMap contributors`** — ODbL 1.0. Required on every plan, by
 *    every vendor that renders OSM data. Nothing removes this, ever.
 * 2. **`© OpenMapTiles`** — required for every style **except** `osm-carto`.
 *    `MAP_STYLE` is `osm-bright`, so it applies here. A future style change to
 *    `osm-carto` is the one thing that would retire this line.
 * 3. **`Powered by Geoapify`** — the Free plan's own service-level condition,
 *    and **the only one a subscription removes**: *"Geoapify paid packages
 *    include the 'White label' option."*
 *
 * **The account was upgraded on 2026-08-27 and this line is still here on
 * purpose.** White Label is described as an *option* included with paid
 * packages, and an option that ships with a plan can still be switched off on
 * the account — nothing this repo can read says which. Keeping the line costs
 * three words and risks nothing; dropping it before White Label is confirmed
 * active is the one part of this component that would be a breach. When it is
 * confirmed, delete `GEOAPIFY_CREDIT` from `CREDITS` and nothing else changes.
 *
 * ## Why the links are not links
 *
 * The documented forms are anchors — `<a href="https://www.geoapify.com/">` and
 * so on. They are rendered as plain text here for the same reason `RideMap`'s
 * old credit was: **both surfaces that draw a tile are already inside an
 * anchor**, the detail panel wrapping the whole tile in a Google Maps deeplink
 * and the card wrapping it in a link to the ride. A nested anchor is invalid
 * HTML that browsers resolve by closing the outer link early, which would cost
 * the tap target the container exists to provide. ODbL requires the credit to
 * be *reasonably calculated to inform*, not to be clickable, and OSM's own
 * guidelines accept a text credit where a link is impractical.
 *
 * ## Two variants, because one tile and forty tiles are different problems
 *
 * **`overlay`** — the corner of a single large tile. `bg-scrim` is `Grey/70%`,
 * which bounds the composite at `#4C4C4C` however bright the map underneath is,
 * giving `White/100` **8.59:1** at worst. Bounded to the pill rather than washed
 * over the tile: darkening the whole map to hold text over it is the trade that
 * cost PD-104 its first detail panel. The ride detail panel uses this.
 *
 * **`inline`** — one credit for a screen carrying many small tiles, drawn on the
 * page background at the end of the list rather than over any single image. The
 * rides list uses this, and the reason is arithmetic rather than taste: the
 * three strings are roughly **240px** at the type floor, and `RideCard`'s strip
 * is **80px** wide. An overlay there wraps to four lines and covers the map,
 * which is the exact defect PD-236 was opened to fix, reproduced in HTML instead
 * of pixels.
 *
 * **One credit for the screen is the Leaflet pattern and it is compliant.** ODbL
 * asks that the credit be reasonably calculated to inform a viewer of the
 * imagery's source, not that it be repeated per image — a page of forty maps
 * credits the page. Geoapify's own guidance names the corner of the map as what
 * *"typically"* happens, which is the overlay case; it does not require it, and
 * it is written for a page showing one map.
 *
 * Product owner, 2026-08-27, choosing this over a per-tile credit: *"as long as
 * we leave the creditation out of the map tiles it's good for now, so at the end
 * of the list is okay for now."* **The "for now" is the part to carry forward**:
 * if the rides list ever paginates or virtualises so the end of the list is not
 * reliably reachable, this placement stops informing anyone and wants revisiting.
 */

/** ODbL 1.0. Every plan, every OSM-based vendor, for ever. */
const OSM_CREDIT = '© OpenStreetMap contributors'

/** Every style except `osm-carto`. `MAP_STYLE` is `osm-bright`. */
const OPENMAPTILES_CREDIT = '© OpenMapTiles'

/**
 * Free-plan condition. Delete this the day White Label is confirmed **active**
 * on the account — not the day the subscription starts. See the header.
 */
const GEOAPIFY_CREDIT = 'Powered by Geoapify'

/**
 * Exported so `src/__tests__/ride-geocode-gates.test.ts` can assert that the
 * credit this app renders is the credit the tile stopped carrying. That test
 * pins the pair together: it used to assert the *absence* of every suppression
 * parameter, which was the right invariant while nothing rendered a credit of
 * our own and became the wrong one the moment this file existed.
 */
export const MAP_CREDITS = [OSM_CREDIT, OPENMAPTILES_CREDIT, GEOAPIFY_CREDIT] as const

export function MapAttribution({
  variant = 'overlay',
  className,
}: {
  variant?: 'overlay' | 'inline'
  className?: string
}) {
  return (
    <span
      className={cn(
        'pointer-events-none text-2xs font-medium',
        variant === 'overlay'
          ? 'absolute rounded bg-scrim px-1.5 py-0.5 text-white'
          : // No scrim: this one sits on the page background, where there is no
            // unknown imagery to hold it legible against. `text-muted` rather
            // than `text-white`, for the same reason.
            'block px-4 pb-2 text-center text-muted',
        className,
      )}
    >
      {MAP_CREDITS.join(' · ')}
    </span>
  )
}
