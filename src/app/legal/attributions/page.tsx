'use client'

import Link from 'next/link'

/**
 * The credits owed for the data behind the app.
 *
 * **The Overture section is GONE, in the same change that dropped the data
 * (`070`, PD-273).** `public.places` — Overture's Places theme, CDLA
 * Permissive 2.0 + Apache 2.0 — is retired; a credit naming Overture's
 * contributors after their data is gone would name contributors who supplied
 * nothing to what a rider is now looking at. `place-search`'s own requirement
 * is explicit that this section leaves with the table, in the same change.
 *
 * **One broadened section rather than a second block, per the same
 * requirement.** The map tiles were already Geoapify-from-OpenStreetMap
 * (PD-104), with an unconditional OpenStreetMap credit; place search now
 * answers through the same vendor (`search-places`, PD-273) and every result
 * carries the same `datasource.attribution: "© OpenStreetMap contributors"`
 * (measured live, `tasks.md` task 0.3). So the existing tile paragraph is
 * widened to say "search results and maps" rather than growing a duplicate
 * paragraph that could drift from it.
 *
 * **Geoapify is named but not linked, and that is the tripwire rather than an
 * oversight.** `src/__tests__/no-geoapify-key.test.ts` refuses the vendor
 * hostname anywhere in `src/` outside one exempt file, so that nothing in the
 * client bundle can grow a direct call to it — both the tiles and the search
 * proxy reach the vendor from our own infrastructure, never from a rider's
 * device. A credit needs the vendor's name, not its host; the link a rider
 * actually needs is OpenStreetMap's.
 *
 * **This page is reachable from Terms and Privacy, which a rider passes through
 * at signup — and from the search sheet itself (`PlaceDataCredit`), which is
 * where a rider actually meets the data.**
 */
export default function AttributionsPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Attributions</h1>

      <p className="text-muted">
        LetsRide is built on open data. This page names the data we take from other people and
        the terms we take it under.
      </p>

      <h2 className="font-semibold">Place search and maps</h2>
      <p className="text-muted">
        The places you search for when setting a ride&rsquo;s meeting point or a club&rsquo;s
        location, and the small map rendered on a ride, both come from Geoapify, built on{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          OpenStreetMap
        </a>{' '}
        data, &copy; OpenStreetMap contributors. The map credit also appears in the corner of
        every map image itself.
      </p>
      <p className="text-muted">
        A place search is sent from our own infrastructure, never from your device, so the
        vendor never sees your identity or your IP address — only the text you typed. Our{' '}
        <Link href="/legal/privacy" className="underline">
          Privacy Statement
        </Link>{' '}
        says more about what is and is not kept.
      </p>

      <p className="text-muted">
        See also our <Link href="/legal/terms" className="underline">Terms and Conditions</Link>{' '}
        and <Link href="/legal/privacy" className="underline">Privacy Statement</Link>.
      </p>
    </>
  )
}
