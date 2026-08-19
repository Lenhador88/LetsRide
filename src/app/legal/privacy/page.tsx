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

      <h2 className="text-base font-semibold pt-4">Who processes your data today</h2>
      <p className="text-muted">
        Not a substitute for the notice above — the binding copy still has to be written. This is
        a plain list of who currently handles your data, so the gap is at least an honest one.
      </p>
      <ul className="text-muted list-disc pl-5 space-y-2">
        <li>
          <span className="font-medium">Supabase</span> — hosts the database, your account and
          sign-in, uploaded photos, and the emails sent to confirm your address or reset your
          password. Everything you enter in the app is stored here.
        </li>
        <li>
          <span className="font-medium">Vercel</span> — serves the app itself. It receives the
          usual request data a web host sees, including your IP address.
        </li>
        {/* Every bullet in this list describes what the app does when a rider
            acts, never what has or has not happened yet. The Geoapify one used
            to sit under a "Planned, and not running yet" heading and to end on
            "Today no ride has coordinates and nothing is sent anywhere" — true
            until the function was deployed and false one second after, on a
            public page describing where a home address goes. A claim that flips
            on an owner action nobody in a session can take is a claim nothing
            will catch. Do not reintroduce one. */}
        <li>
          <span className="font-medium">Geoapify</span> — turns a ride&rsquo;s meeting point into
          map coordinates and renders the small map shown on a ride. Saving a ride sends the
          meeting point you typed to Geoapify, and editing it sends the new one.{' '}
          <span className="font-medium">
            A meeting point is often a home address, so treat it as one.
          </span>{' '}
          The coordinates and the map image are stored by us; your device never contacts Geoapify,
          and the map you see is served from our own storage.
        </li>
      </ul>
      <p className="text-muted">
        <Link href="/legal/account-deletion" className="underline">
          How to delete your account
        </Link>
      </p>
      <p className="text-muted">
        <Link href="/legal/attributions" className="underline">
          Attributions
        </Link>
      </p>
    </>
  )
}
