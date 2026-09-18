'use client'

import Link from 'next/link'

import { SUPPORT_EMAIL } from '@/lib/support'
import { OPERATOR, TERMS_LAST_UPDATED, TERMS_VERSION } from '@/lib/legal/terms'

/**
 * The binding terms, replacing the placeholder that disclaimed being an
 * agreement while the signup checkbox pointed at it (PD-459).
 *
 * Static copy, and one of the pages a rider can reach without a session
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
 *
 * ## What this text is, and what it is not
 *
 * Written by a session against the product owner's four decisions of
 * 2026-09-18: the counterparty is Pedro personally rather than a company, the
 * governing law is Dutch, the minimum age is 16, and the contact address is the
 * one `SUPPORT_EMAIL` publishes. **It has not been reviewed by a lawyer**, and
 * the PR that introduced it says so rather than implying otherwise. It is a
 * large improvement on a page that disclaimed being an agreement while riders
 * accepted it; it is not a substitute for counsel before launch.
 *
 * **Two clauses are promises the product keeps, and the rest are promises about
 * conduct.** §4 (rides are not ours) and §7 (reporting) are the two a reviewer
 * checks against the app, and both are true today: nothing here organises or
 * vets a ride, and report/block/hide are built. Do not add a clause describing
 * a mechanism this app does not have — that is the failure mode the placeholder
 * at least avoided by saying nothing.
 *
 * **The version string is `lib/legal/terms.ts`'s and the database's, and they
 * must agree.** `private.current_terms_version()` (`030`) stamps
 * `profiles.terms_version` at the moment a rider accepts, so a page that says
 * one version while the database records another makes every consent row
 * unreadable as evidence. `src/lib/legal/__tests__/terms.test.ts` pins the two
 * together against the migration that owns the value.
 */
export default function TermsPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Terms and Conditions</h1>
      <p className="text-muted">
        Version {TERMS_VERSION} · last updated {TERMS_LAST_UPDATED}
      </p>
      <p className="text-muted">
        These terms are the agreement between you and us about your use of LetsRide. By
        ticking the box at signup you accept them. If you do not accept them, you cannot use
        the app.
      </p>

      <h2 className="text-base font-semibold pt-4">1. Who we are</h2>
      <p className="text-muted">
        LetsRide is run by {OPERATOR.name}, a private individual established in the
        Netherlands, at {OPERATOR.address}. We are not a company. You can reach us at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
          {SUPPORT_EMAIL}
        </a>
        , and that is the address to use for anything in these terms — questions, complaints,
        reports and requests about your data.
      </p>

      <h2 className="text-base font-semibold pt-4">2. What LetsRide is</h2>
      <p className="text-muted">
        An app for motorcycle riders to plan rides, join clubs and share photos of the riding
        they have done. It is free to use. We may add, change or remove features.
      </p>

      <h2 className="text-base font-semibold pt-4">3. Who can use it</h2>
      <p className="text-muted">
        You must be <span className="font-medium">at least 16 years old</span>. You need one
        account, and you are responsible for what happens under it — keep your password to
        yourself, and tell us if you think someone else has it.
      </p>

      <h2 className="text-base font-semibold pt-4">4. Rides happen in the real world</h2>
      <p className="text-muted">
        <span className="font-medium">
          This is the most important clause here, so it is in plain words: we do not organise
          the rides in this app, and you take part at your own risk.
        </span>{' '}
        A ride is planned by a rider, for riders. We do not lead it, supervise it, vet it or
        insure it. We do not check anyone&rsquo;s licence, insurance, riding ability or the
        state of their motorcycle, and we do not check that a route is safe or legal.
      </p>
      <p className="text-muted">
        You are responsible for your own riding: for being licensed and insured, for your
        motorcycle being roadworthy, for obeying traffic law, for the gear you wear and for
        riding within your ability and the conditions. What happens on a ride is between the
        people who are there.
      </p>

      <h2 className="text-base font-semibold pt-4">5. What you post</h2>
      <p className="text-muted">
        Your photos, captions, comments and messages stay yours. You give us permission to
        store them and to show them to the riders you chose to show them to — a club, a ride,
        or everyone signed in — so the app can work. That permission ends when you delete the
        content or your account, except for copies in ordinary backups.
      </p>
      <p className="text-muted">
        Post only what you have the right to post. If a photo is not yours, or shows someone
        who would rather not be shown, do not put it here.
      </p>

      <h2 className="text-base font-semibold pt-4">6. What is not allowed</h2>
      <p className="text-muted">
        We have no tolerance for objectionable content or for abusive riders. Do not post, send
        or do any of this:
      </p>
      <ul className="text-muted list-disc pl-5 space-y-2">
        <li>Abuse, harassment, bullying, threats, or hatred aimed at people for who they are.</li>
        <li>Sexual content, nudity, or anything at all involving a child.</li>
        <li>Content that is illegal, or that encourages illegal or dangerous riding.</li>
        <li>Pretending to be someone else, or posting someone else&rsquo;s personal details.</li>
        <li>Spam, scams, advertising, or scraping the app or other riders&rsquo; content.</li>
        <li>Trying to break, overload or get around the security of the app.</li>
      </ul>

      <h2 className="text-base font-semibold pt-4">7. Reporting, and what we do about it</h2>
      <p className="text-muted">
        Every postcard and every club discussion has a <span className="font-medium">Report</span>{' '}
        option, you can <span className="font-medium">block</span> a rider so neither of you
        sees the other, and you can <span className="font-medium">hide</span> a postcard you
        would rather not see. Blocking and hiding can both be undone from Profile &rarr;
        Privacy. You can also write to us at the address in §1.
      </p>
      <p className="text-muted">
        We read reports and aim to act on them within 24 hours. We can remove content and
        suspend or close an account that breaks §6, without notice where the content is
        serious. We do not read everything that is posted, and we do not promise to catch
        everything before you see it — which is why reporting matters.
      </p>

      <h2 className="text-base font-semibold pt-4">8. Your privacy</h2>
      <p className="text-muted">
        What we collect and who processes it is in our{' '}
        <Link href="/legal/privacy" className="underline">
          Privacy Statement
        </Link>
        .
      </p>

      <h2 className="text-base font-semibold pt-4">9. Leaving</h2>
      <p className="text-muted">
        You can delete your account from inside the app at any time, and{' '}
        <Link href="/legal/account-deletion" className="underline">
          this page
        </Link>{' '}
        says exactly what that removes and what it does not. We can suspend or close your
        account if you break these terms.
      </p>

      <h2 className="text-base font-semibold pt-4">10. What we can and cannot promise</h2>
      <p className="text-muted">
        LetsRide is free, and we cannot promise it is always available, always correct, or that
        it will keep running. We may change it or stop it, and we will tell riders beforehand
        where we reasonably can.
      </p>
      <p className="text-muted">
        We are not responsible for what happens on a ride, or for what other riders do, say or
        post. For anything else, our liability is limited as far as Dutch law allows. Nothing
        here limits our liability for intent or deliberate recklessness on our part, for death
        or personal injury caused by us, or any right you have as a consumer that cannot be
        signed away.
      </p>

      <h2 className="text-base font-semibold pt-4">11. Changes to these terms</h2>
      <p className="text-muted">
        We may update these terms. The version and date at the top tell you which text you are
        reading, and we record which version you accepted. If a change matters to you, we will
        ask you to accept the new version before you carry on using the app.
      </p>

      <h2 className="text-base font-semibold pt-4">12. Which law applies</h2>
      <p className="text-muted">
        Dutch law applies to these terms, and disputes go to the competent court in the
        Netherlands. If you are a consumer, this does not take away the protection of the law
        of the country you live in.
      </p>

      <p className="text-muted pt-4">
        <Link href="/legal/privacy" className="underline">
          Privacy Statement
        </Link>
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
