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
 * ## Nothing is drawn over a tile, on any surface
 *
 * Product owner, 2026-08-27: *"as long as we leave the creditation out of the
 * map tiles it's good for now, so at the end of the list is okay for now."* So
 * the credit is always page furniture, never an overlay — on the detail panel it
 * sits directly beneath the map, and on a list it sits at the end.
 *
 * **That also settles a measurement this component got wrong once.** An earlier
 * revision put an `overlay` variant in the corner of the detail panel on the
 * strength of the joined string being "roughly 240px at the type floor". It is
 * 67 characters, and 10px Poppins Medium at ~0.52–0.55em average advance is
 * **~350–370px** — wider than the panel itself below a 390px viewport (the panel
 * is the page width less 32, so 328 at 360 and 288 at 320). A corner pill there
 * wraps to two or three scrimmed lines across the top of the map, which is the
 * trade that cost PD-104 its first detail panel. Measure the string before
 * putting it anywhere narrow.
 *
 * **`text-foreground`, not `text-muted`.** The page background is a 135°
 * gradient running `#F2ECE6` → `#CCB8A3` over the full scroll height, and this
 * element renders at the far end of it — the darkest point. `#666666` there is
 * **2.99:1**, a WCAG AA failure at 10px, where the same token passes at 4.90:1
 * on the gradient's start. `#1A1A1A` clears 4.5:1 across every stop. A credit
 * that cannot be read is weak evidence of being *"reasonably calculated to
 * inform"*, which is the standard ODbL actually sets.
 *
 * ## Where it goes, and the one thing that is unresolved
 *
 * ODbL 1.0 §4.3 asks for a notice *reasonably calculated to make any Person
 * that... views... the Produced Work aware* of the source. It does not require
 * one notice per image, so crediting a screen rather than each of its forty
 * tiles is a sound reading — and Geoapify's own *"you need to care about
 * attributions yourself"* sanctions rendering it ourselves.
 *
 * **The step that does NOT follow is from "once per screen" to "at the end of a
 * scrolling list".** Those are different placements: the end of the list is
 * below the fold from about the fifth card, so a rider who opens the screen,
 * sees four tiles and taps one is never shown the notice.
 * `openspec/changes/add-ride-map-tiles/specs/ride-map-tiles/spec.md` refuses
 * exactly this design in as many words — *"a single shared credit elsewhere on
 * the screen SHALL NOT be accepted as covering the tiles, because a list is
 * scrolled and a card is what a rider sees"* — and that requirement has not been
 * amended. The owner's *"for now"* is doing real work here and is the reason this
 * ships: it is a provisional placement on a pilot with no riders, not a settled
 * answer, and PD-236 carries the open question.
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

export function MapAttribution({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        // No scrim anywhere: nothing here is ever drawn over imagery, so there
        // is no unknown background to hold it legible against — only the app
        // gradient, which `text-foreground` clears at every stop.
        'pointer-events-none block px-4 pb-2 text-center text-2xs font-medium text-foreground',
        className,
      )}
    >
      {MAP_CREDITS.join(' · ')}
    </span>
  )
}
