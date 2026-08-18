'use client'

import Link from 'next/link'

/**
 * The credits owed for the data behind the app. Two vendors, two obligations,
 * deliberately two paragraphs — merging them is how the wrong credit gets
 * attached to the wrong dataset.
 *
 * **`places` is Overture's Places theme, and it is NOT ODbL.** This repo
 * assumed an OpenStreetMap credit; a census of the extract found zero
 * OSM-sourced rows (`scripts/places/README.md` §Attribution), and Overture
 * publishes the Places theme under CDLA Permissive 2.0 and Apache 2.0 — no
 * share-alike, and CDLA §3 exempts what an app renders ("Results") from
 * carrying the licence text. So the Overture line below is the cheap version of
 * the obligation, paid in full and in one place, so no future screen has to ask
 * the question again.
 *
 * **The map tiles are Geoapify, whose OpenStreetMap credit IS unconditional**
 * (PD-104) — and it is already discharged in the tile itself, which the Static
 * Maps API burns in bottom-right and `RideMap` must never crop or cover. The
 * line below states it in text as well, because a rider reading this page
 * should not have to infer it from a 148 px image.
 *
 * **Geoapify is named but not linked, and that is the tripwire rather than an
 * oversight.** `src/__tests__/no-geoapify-key.test.ts` refuses the vendor
 * hostname anywhere in `src/` outside one exempt file, so that nothing in the
 * client bundle can grow a direct call to it — the tiles come from our own
 * storage, rendered by an Edge Function. A credit needs the vendor's name, not
 * its host; the link a rider actually needs is OpenStreetMap's.
 *
 * **This page is reachable from Terms and Privacy, which a rider passes through
 * at signup — and from nowhere inside the app.** That is enough while nothing
 * renders a place result. The first screen that does (PD-259's club location,
 * PD-114's ride address picker) must link here from its search sheet, which is
 * where a rider meets the data.
 */
export default function AttributionsPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Attributions</h1>

      <p className="text-muted">
        LetsRide is built on open data. This page names the data we take from other people and
        the terms we take it under.
      </p>

      <h2 className="font-semibold">Places and addresses</h2>
      <p className="text-muted">
        The places you search for when setting a ride&rsquo;s meeting point or a club&rsquo;s
        location come from the{' '}
        <a
          href="https://overturemaps.org"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Overture Maps Foundation
        </a>
        , used under the{' '}
        <a
          href="https://cdla.dev/permissive-2-0/"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Community Data License Agreement &ndash; Permissive 2.0
        </a>{' '}
        and the{' '}
        <a
          href="https://www.apache.org/licenses/LICENSE-2.0"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Apache License 2.0
        </a>
        . Overture&rsquo;s places data is contributed by Meta, Foursquare, Microsoft,
        AllThePlaces, PinMeTo, DAC and Krick.
      </p>
      <p className="text-muted">
        We hold our own copy of that data, so what you type into a place search stays with us
        and never reaches Overture or any of its contributors. The meeting point you go on to
        save is a separate matter, and our{' '}
        <Link href="/legal/privacy" className="underline">
          Privacy Statement
        </Link>{' '}
        says where that goes.
      </p>

      <h2 className="font-semibold">Maps</h2>
      <p className="text-muted">
        The small map on a ride is rendered by Geoapify from{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          OpenStreetMap
        </a>{' '}
        data, &copy; OpenStreetMap contributors. That credit also appears in the corner of
        every map image itself.
      </p>

      <p className="text-muted">
        See also our <Link href="/legal/terms" className="underline">Terms and Conditions</Link>{' '}
        and <Link href="/legal/privacy" className="underline">Privacy Statement</Link>.
      </p>
    </>
  )
}
