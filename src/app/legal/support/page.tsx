'use client'

import Link from 'next/link'

import { OPERATOR } from '@/lib/legal/terms'
import { SUPPORT_EMAIL } from '@/lib/support'

/**
 * The page the App Store Connect **Support URL** points at.
 *
 * Apple's requirement is that the field *"must lead to actual contact
 * information (legal address, email address, telephone number)"*, and a
 * `mailto:` is not a URL that satisfies it — so the address has to be **on a
 * page**, as text a reviewer can read, not only inside an `href`. That is what
 * `__tests__/page.test.tsx` pins, and it is the half a tidy-up reverses in
 * silence by turning the address into the words "contact us".
 *
 * Public with no guard change: protection is a denylist of public paths and
 * `/legal/*` is on it (`src/lib/auth/guard.ts`). It reads no table and adds no
 * `anon` grant, so decision #1 is untouched — this is copy, not a data surface.
 *
 * **Three numbers on this page are published elsewhere and must not drift.**
 * The 24 hours for reports is `/legal/terms` §7 and `/legal/privacy`; the
 * address is `SUPPORT_EMAIL`; and who runs the app is §1 of the terms, where
 * the operator's name is still owed (PD-459) — this page must not invent one,
 * so it points at that clause rather than restating it.
 *
 * **It must not grow a form.** A support form is a mail sender, an abuse
 * surface and a personal-data sink; the address is the whole point, and the
 * one thing a reviewer and a locked-out rider both need.
 */
export default function SupportPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Support</h1>

      <p className="text-muted">
        LetsRide is an app for motorcycle riders: plan a ride together, join a club, and keep
        the photos afterwards. This page is how you reach the people behind it.
      </p>

      <h2 className="font-semibold">Email us</h2>
      {/*
        The address is rendered as visible text AND as the link, rather than as
        link text reading "email us". Apple's Support URL wants contact
        information on the page; Guideline 1.2 wants a published route to a
        person for an app carrying user-generated content. One address, from
        `src/lib/support.ts` — `src/__tests__/support-email.test.ts` refuses a
        second copy anywhere a rider can be shown it.
      */}
      <p className="text-muted">
        Write to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
          {SUPPORT_EMAIL}
        </a>
        . A person reads it. Tell us which screen you were on and what you expected to happen —
        a screenshot helps more than anything else.
      </p>
      <p className="text-muted">
        If you are writing about your own account, write from the email address you signed up
        with. It is the only way we can tell the account is yours.
      </p>
      <p className="text-muted">
        We aim to reply within three working days. Reports of content are faster, below.
      </p>

      <h2 className="font-semibold">Reporting a postcard or a discussion</h2>
      <p className="text-muted">
        Every postcard and every club discussion carries a{' '}
        <span className="font-medium">Report</span> option. Reports are read by us and by
        nobody else — no other rider can see that you filed one — and we aim to act on them
        within 24 hours. If the thing you want to report has no Report option on it, email the
        address above and we will treat it exactly the same way.
      </p>
      <p className="text-muted">
        You can also <span className="font-medium">block</span> a rider, after which the two of
        you disappear from each other, and <span className="font-medium">hide</span> a postcard
        you would rather not see. Both can be undone from Profile &rarr; Privacy. What is and
        is not allowed is §6 of our{' '}
        <Link href="/legal/terms" className="underline">
          Terms and Conditions
        </Link>
        .
      </p>

      <h2 className="font-semibold">Getting back into your account</h2>
      <p className="text-muted">
        If you have forgotten your password, use{' '}
        <span className="font-medium">Forgot password</span> on the sign-in screen and we will
        email you a link. If the email address on the account is one you can no longer read,
        write to us and say so — we cannot send a reset to a different address, but we can
        delete the account so the username and email are free again.
      </p>
      <p className="text-muted">
        Deleting your account is something you do yourself, from inside the app.{' '}
        <Link href="/legal/account-deletion" className="underline">
          Deleting your account
        </Link>{' '}
        says exactly what goes and what stays.
      </p>

      <h2 className="font-semibold">Who you are writing to</h2>
      {/*
        A pointer, never a restatement. Terms §1 branches on `OPERATOR`
        (`src/lib/legal/terms.ts`) — a legal name and a HOME address today, and
        `null` again the day PD-462 decides that was the wrong trade. Copying
        either string here would publish it twice, double what PD-462 has to
        un-publish, and leave this page asserting something the terms had
        stopped saying. So this branches on the same constant the terms page
        branches on, and neither arm says anything the other would falsify.
      */}
      {OPERATOR ? (
        <p className="text-muted">
          LetsRide is run by a private individual established in the Netherlands, not by a
          company. Their name and postal address are in §1 of the{' '}
          <Link href="/legal/terms" className="underline">
            Terms and Conditions
          </Link>
          .
        </p>
      ) : (
        <p className="text-muted">
          LetsRide is run by a private individual established in the Netherlands, not by a
          company. §1 of the{' '}
          <Link href="/legal/terms" className="underline">
            Terms and Conditions
          </Link>{' '}
          says what details you are entitled to and how to ask for them.
        </p>
      )}

      <p className="text-muted">
        See also our <Link href="/legal/privacy" className="underline">Privacy Statement</Link>{' '}
        and our{' '}
        <Link href="/legal/attributions" className="underline">
          Attributions
        </Link>
        .
      </p>
    </>
  )
}
