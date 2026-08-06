'use client'

import Link from 'next/link'

/**
 * Static copy, and one of the two pages a rider can reach without a session
 * (decision #1's deliberate exception, and `/legal/*` in the guard's public
 * denylist). It reads nothing, so there is no query here and no loading state —
 * the directive is here only because the client-rendered shell has no server to
 * render a server page on.
 *
 * **The `metadata` export had to go with it**, and that is the one behaviour
 * this file could not preserve. Next refuses to compile a `metadata` export from
 * a module marked `'use client'`; the tab now reads the root layout's
 * `LetsRide — Ride Together` rather than `Terms and Conditions — LetsRide`. A
 * rendered `<title>` is not the fix — Next renders its own metadata into the
 * head slot ahead of the page tree, so a second `<title>` hoisted out of the
 * body loses, and React's own docs call two titles undefined behaviour. When
 * the shell lands and the Metadata API goes with the server render, every
 * screen's title has to be set client-side; this one comes back there.
 */
export default function TermsPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Terms and Conditions</h1>
      <p className="text-muted">
        Placeholder. The signup flow links here because a rider must be able to read these
        terms before accepting them; the binding copy is a legal deliverable and has not been
        written yet.
      </p>
      <p className="text-muted">
        Do not treat this page as an agreement. It exists so the signup checkbox has a real
        destination, and must be replaced before the app accepts real users.
      </p>
      <p className="text-muted">
        <Link href="/legal/account-deletion" className="underline">
          How to delete your account
        </Link>
      </p>
    </>
  )
}
