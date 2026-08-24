'use client'

import Link from 'next/link'

import { SUPPORT_EMAIL } from '@/lib/support'

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
          map coordinates and renders the small map shown on a ride, and answers the place search
          you use to set a ride&rsquo;s meeting point or a club&rsquo;s location. Saving a ride
          sends the meeting point you typed to Geoapify, and editing it sends the new one; typing
          into a place search sends the text as you type it, the same way.{' '}
          <span className="font-medium">
            A meeting point — and often a search term — is a home address, so treat both as one.
          </span>{' '}
          The coordinates and the map image are stored by us; a search term is not — we keep only
          that a search happened and when, never what was typed. Your device never contacts
          Geoapify directly either way: every request is made from our own infrastructure, so the
          map you see is served from our own storage and a search never discloses your identity,
          session or IP address to Geoapify.
        </li>
      </ul>
      {/*
        App Store Review Guideline 1.2 asks a user-generated-content app for four things: a
        way to report, a way to block, a way to hide, and a route to a human who acts on what
        is reported. The first three were built and this page said nothing about any of them,
        which made the fourth unreachable — a rider had nowhere to write and a reviewer had
        nothing to check. PD-297 built the read path behind it; this section is where a rider
        finds out it exists.

        The address is `SUPPORT_EMAIL`, never a literal — see that file, which still carries
        an owner question about the mailbox itself.

        "its photo stops being viewable immediately" is a MECHANISM and is why that clause can
        be written in the present tense: `010` §2's read policy on `storage.objects` requires a
        `postcards` row whose `image_path` is the object AND whose author owns the folder, and
        the `media` bucket is private — so an object with no row pointing at it is unreadable by
        everyone, the uploader included. `010` §2 states that consequence in those words.

        "We delete the stored file as well" is a PROCEDURE and is deliberately a separate
        sentence. No cascade reaches Storage (`009` §3), so it is step two of `076`'s runbook,
        done by a human. Do not merge the two clauses into one that reads as automatic.
      */}
      <h2 className="text-base font-semibold pt-4">Reporting content, and how to reach us</h2>
      <p className="text-muted">
        Every postcard carries a <span className="font-medium">Report</span> control, and you
        can also <span className="font-medium">hide</span> a single postcard or{' '}
        <span className="font-medium">block</span> a rider outright. Hiding affects only what
        you see. Blocking is mutual: you and the rider you block disappear from each
        other&rsquo;s feeds, clubs, ride crews and chats.
      </p>
      <p className="text-muted">
        Reports are read by us, not by other riders — nobody else can see that you filed one.
        We aim to review each report within 24 hours and to remove anything that breaks our{' '}
        <Link href="/legal/terms" className="underline">
          Terms and Conditions
        </Link>
        . Removing a postcard takes its comments and its likes with it, and its photo stops being
        viewable immediately — no account can fetch an image whose postcard is gone. We delete the
        stored file as well.
      </p>
      <p className="text-muted">
        If something needs attention sooner, or you would rather write to a person than use the
        in-app control, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>

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
