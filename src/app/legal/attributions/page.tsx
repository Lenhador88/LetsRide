'use client'

import Link from 'next/link'

/**
 * The credit owed for the place index behind address search.
 *
 * **`places` is Overture's Places theme, and it is NOT ODbL.** This repo
 * assumed an OpenStreetMap credit for months; a census of the extract found
 * zero OSM-sourced rows (`scripts/places/README.md`), and Overture publishes
 * the Places theme under CDLA Permissive 2.0 and Apache 2.0 — no share-alike,
 * and no obligation to stamp a credit on every rendered result. Crediting
 * OpenStreetMap here would credit a contributor that supplied nothing.
 *
 * So the sentence below is not a licence requirement we are satisfying to the
 * letter — CDLA Permissive 2.0 §3 treats what an app renders as "Results",
 * which are exempt from carrying the licence text at all. It is the cheap
 * version of the obligation, paid in full and in one place, so that no future
 * screen has to ask the question again.
 *
 * **Map tiles are a different vendor and a different obligation.** Geoapify
 * requires an unconditional OpenStreetMap credit (PD-104), and that line
 * belongs on this page when tiles ship — beside the Overture one, never
 * merged into it.
 */
export default function AttributionsPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Attributions</h1>

      <p className="text-muted">
        LetsRide is built on open data. This page names what we use and who it came from.
      </p>

      <h2 className="font-semibold">Places and addresses</h2>
      <p className="text-muted">
        The addresses and places you search for when setting a ride&rsquo;s meeting point or a
        club&rsquo;s location come from the{' '}
        <a href="https://overturemaps.org" className="underline">
          Overture Maps Foundation
        </a>
        , used under the{' '}
        <a href="https://cdla.dev/permissive-2-0/" className="underline">
          Community Data License Agreement &ndash; Permissive 2.0
        </a>{' '}
        and the{' '}
        <a href="https://www.apache.org/licenses/LICENSE-2.0" className="underline">
          Apache License 2.0
        </a>
        . Overture&rsquo;s places data is contributed by Meta, Foursquare, Microsoft,
        AllThePlaces, PinMeTo, DAC and Krick.
      </p>
      <p className="text-muted">
        We hold a copy of that data on our own servers, so searching for a place does not send
        anything you type to Overture or to any of its contributors.
      </p>

      <p className="text-muted">
        See also our <Link href="/legal/terms" className="underline">Terms and Conditions</Link>{' '}
        and <Link href="/legal/privacy" className="underline">Privacy Statement</Link>.
      </p>
    </>
  )
}
