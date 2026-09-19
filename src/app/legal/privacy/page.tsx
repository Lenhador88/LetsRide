'use client'

import Link from 'next/link'

import { SUPPORT_EMAIL } from '@/lib/support'

/**
 * Static copy, and one of the four pages a rider can reach without a session
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
        This describes what LetsRide collects about you, who else it reaches, and what you can
        do about it. It is written from what the app actually does rather than from a template,
        and we keep it that way — if something here stops being true, the page changes.
      </p>

      <h2 className="text-base font-semibold pt-4">Who processes your data today</h2>
      {/* This paragraph replaced a dangling one. The page used to open on "Do not
          treat this page as a privacy notice", and PD-459 deleted that line —
          correctly, because 212 lines of accurate, measured notice sat under it
          and the App Store listing points here. But the sentence below it read
          "Not a substitute for THE NOTICE ABOVE", whose referent went with it,
          and it then contradicted the new opening two paragraphs later.

          Deleting a disclaimer is bigger than it looks: it turns an honest
          incomplete page into a complete-sounding incomplete page. What the
          disclaimer was carrying, and what is said here instead, is the art. 13
          GDPR core this page still does not have — legal bases, retention,
          rights, the supervisory authority. Name what is missing; do not go
          back to denying that the page is what it plainly is. */}
      <p className="text-muted">
        A plain list of who currently handles your data. What this page does not set out yet is
        the legal basis for each use, how long we keep things, and how to exercise your rights
        under the GDPR — including your right to complain to the Autoriteit Persoonsgegevens.
        Until those are here, ask us at the address at the end of this page and we will answer.
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
        {/* PD-303, and it is the first bullet on this page describing content
            that RLS governs leaving Supabase for a third party at all. Every
            outbound call before this one sends a query string or a coordinate;
            this one sends another rider's username and, on a private club or a
            non-public ride, the name a rider chose expecting it to stay inside
            that club.

            Written to the same rule as Geoapify and Sentry above — what the app
            does when something happens, never what is or is not switched on
            yet. "No push is delivered today" would be true until the owner
            installs a provider key nobody in a session can reach, and false one
            second after, on a public page describing where a rider's data goes.
            The deploy moves without this file moving; do not reintroduce a
            claim that depends on it.

            The disclosure obligation begins with the first delivered push, and
            the push is what discloses — NOT the lock screen. Design Q4 is
            explicit that asking only about the lock screen is materially the
            wrong question: that surface is the rider's own device, the
            sub-processor is not. So the bullet names transmission first and the
            lock screen second, and a rewrite that leads on "anyone can read it
            on your phone" has lost the point of it. */}
        <li>
          <span className="font-medium">Apple and Google</span> — deliver notifications to your
          phone. When something happens that you asked to be told about — someone likes your
          postcard, joins your ride, replies in your club — the text of that notification is sent
          to Apple (on an iPhone) or Google (on an Android phone), who pass it to your device.{' '}
          <span className="font-medium">
            That text includes the other rider&rsquo;s username, and the name of the club or the
            title of the ride it happened in, including when that club or ride is private.
          </span>{' '}
          It is sent to them unencrypted by us, along with an identifier for your installation of
          the app, because that is the only way either company will deliver a notification at all.
          It also means the text appears on your lock screen — both phones let you turn that off
          per app in your own settings, and turning notifications off in{' '}
          <span className="font-medium">Profile</span> stops us sending them in the first place.
        </li>
        {/* PD-315. Written to the same rule as the Geoapify bullet above: it
            describes what the app does when something happens, never what has
            or has not been switched on yet. A sentence like "we do not use
            error reporting today" is true until a DSN is set in a dashboard
            nobody in a session can reach, and false one second after — on a
            public page describing where a rider's data goes.

            The IP clause is the one to keep honest. `sendDefaultPii: false`
            means the SDK attaches no IP to the report, and the connection that
            delivers it still discloses one, exactly as the Vercel bullet
            already says of the app itself. Claiming the first without the
            second would be the kind of true-sounding sentence this page exists
            not to contain. */}
        <li>
          <span className="font-medium">Sentry</span> — records the technical detail of a
          failure so we find out the app broke for you. Nothing is sent while it is working:
          a report is made only when a screen fails or the app crashes. It carries which
          screen you were on, the version you are running, an internal reference to your
          account, and where in the code the failure happened.{' '}
          <span className="font-medium">
            It does not carry your email address, your username, your photos, anything you
            typed, or the place you searched for
          </span>{' '}
          — addresses in the app&rsquo;s own links are removed before a report leaves your
          device. Sentry sees your IP address the way any website you connect to does, but we
          do not attach it to the report.
        </li>
        {/* PD-353, and PD-456 which switched screen recording OFF on
            2026-09-18. This bullet no longer describes a replay, because there
            is no longer one to describe — `disable_session_recording` is
            `true`.

            Two claims it must still NOT make, each of which the obvious
            wording makes by accident:

            1. That the opt-out deletes anything. It stops future collection.
               `delete-account` does not reach PostHog at all, so a rider who
               erases their account still leaves their events behind — an open
               item on PD-353, and until it is wired the only honest thing to
               name is the email route, exactly as the account-deletion page
               already does for riders who cannot sign in.
            2. That recording having stopped un-collects what was already
               recorded. It does not. The pilot ran, and the page says so in
               the past tense rather than quietly dropping the paragraph —
               a rider who read the old wording and opted out because of it is
               owed the rest of that sentence.

            The claim about appearing in another rider's recording is gone
            because the thing it warned about is gone. Put it back verbatim if
            replay ever returns, masked or not: it was true of any recording,
            not only an unmasked one.

            Written in the present tense about what the app does when a rider
            acts, like every other bullet here. */}
        <li>
          <span className="font-medium">PostHog</span> — records how the app is used, so we can
          see what is broken or confusing while LetsRide is small. It receives the screens you
          open and moments like creating a ride or joining a club.{' '}
          <span className="font-medium">It does not record your screen.</span> What it gets is
          the name of the screen and the action, not a picture of it and not what you type.
        </li>
        <li className="list-none pl-0 pt-2">
          <span className="font-medium">We used to be set up to record screens, and
          stopped.</span> Until September 2026 this app was configured to send PostHog a video
          replay of your own screen. That is switched off and no longer happens to anybody.
          Whether any recording of you was ever actually made depends on whether you had turned
          usage data on at the time — if you want any that exist deleted, email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>{' '}
          and ask.
        </li>
        <li className="list-none pl-0 pt-2">
          <span className="font-medium">Turning the rest off, and what it does not do.</span>{' '}
          Open <span className="font-medium">Profile</span>, then the menu, then{' '}
          <span className="font-medium">Privacy</span>. It stops any further collection from
          that moment. It does not delete what has already been collected, and deleting your
          account does not delete it either — for that, use the same address above.
        </li>
      </ul>
      {/*
        App Store Review Guideline 1.2 asks a user-generated-content app for four things: a
        way to report, a way to block, a way to hide, and a route to a human who acts on what
        is reported. The first three were built and this page said nothing about any of them,
        which made the fourth unreachable — a rider had nowhere to write and a reviewer had
        nothing to check. PD-297 built the read path behind it; this section is where a rider
        finds out it exists.

        The address is `SUPPORT_EMAIL`, never a literal. PD-300 settled which mailbox it is;
        that file records the measurement and the one thing DNS cannot answer.

        THE PHOTO CLAUSE IS THE ONE TO GET RIGHT, and its first version was wrong in a way that
        reads as measured. It said the photo "stops being viewable immediately — no account can
        fetch an image whose postcard is gone", reasoning from `010` §2: the `media` bucket is
        private and the Storage SELECT policy resolves through a `postcards` row, so an orphaned
        object is unreadable. Both halves are true and the conclusion does not follow, **because
        the app never does an RLS-mediated read of an image**. `src/lib/data/media.ts` hands the
        browser a SIGNED URL, and Supabase validates the signature rather than re-running the
        policy — so a rider whose feed rendered the postcard before the take-down keeps a working
        URL until `SIGNED_URL_TTL_SECONDS` (one hour) expires, and so does anyone they forward it
        to, signed out or with no account at all.

        So deleting the stored file is not the tidy-up it looked like: it is the only thing that
        ends access, and until it runs the window is the TTL. That is why the copy now names the
        hour instead of promising an instant, and why `076`'s runbook calls step two time-bounded
        rather than optional. Do not restore a sentence that reads as automatic or immediate.
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
        . Removing a postcard takes its comments, its likes and the notifications about it with
        it, and we delete the stored photo as well. Photo links are signed and expire within an
        hour, so a link somebody had already loaded can keep working until we delete the file.
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
