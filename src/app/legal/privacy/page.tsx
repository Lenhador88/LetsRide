'use client'

import Link from 'next/link'

/**
 * Static copy, and one of the three pages a rider can reach without a session
 * (decision #1's deliberate exception, and `/legal/*` in the guard's public
 * denylist). It reads nothing, so there is no query here and no loading state —
 * the directive is here only because the client-rendered shell has no server to
 * render a server page on.
 *
 * **The `metadata` export had to go with it**, and that is the one behaviour
 * this file could not preserve. Next refuses to compile a `metadata` export from
 * a module marked `'use client'`; the tab now reads the root layout's
 * `LetsRide — Ride Together` rather than `Privacy Statement — LetsRide`. See
 * `../terms/page.tsx` for why a rendered `<title>` is not the substitute it
 * looks like.
 */
export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Privacy Statement</h1>
      <p className="text-muted">
        Placeholder. The signup flow links here because a rider must be able to read this
        before accepting it; the binding copy is a legal deliverable and has not been written
        yet.
      </p>
      <p className="text-muted">
        Do not treat this page as a privacy notice. It exists so the signup checkbox has a
        real destination, and must be replaced before the app accepts real users.
      </p>
      <p className="text-muted">
        <Link href="/legal/account-deletion" className="underline">
          How to delete your account
        </Link>
      </p>
    </>
  )
}
