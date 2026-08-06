'use client'

import Link from 'next/link'

/**
 * The web-accessible deletion route Google Play's User Data policy requires:
 * a rider must be able to find out how to delete their account without
 * installing the app. Public, under the `/legal/` prefix the route guard
 * already treats as a denylist entry, so it needs no guard change — see
 * `src/lib/auth/guard.ts`.
 *
 * **It reads no table, holds no personal data and adds no `anon` grant.**
 * Decision #1 is untouched: this page is copy, not a data surface.
 *
 * **It must never grow a form that accepts a deletion request.** A page that
 * deletes an account on an emailed identifier is an account-deletion service
 * for strangers — the deletion path takes no user id at all, precisely so that
 * class of bug is unrepresentable rather than merely guarded against.
 *
 * Unlike `terms/` and `privacy/`, this is NOT placeholder copy. Everything
 * below describes what the cascade actually does, which `029` made true and
 * `supabase/tests/rls_test.sql` asserts. The one time-sensitive sentence is
 * flagged in the markup and comes out when the in-app flow ships.
 */
export default function AccountDeletionPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Deleting your account</h1>

      <p className="text-muted">
        You delete your LetsRide account yourself, from inside the app. Nobody else can delete
        it for you — there is no administrator account, and the deletion only ever applies to
        the rider who asks for it. It is immediate and cannot be undone: there is no grace
        period and no way to recover the account afterwards.
      </p>

      {/*
        THE ONE PARAGRAPH THAT IS NOT YET TRUE, and it is deliberately the most prominent
        thing on the page rather than a footnote. `main` auto-deploys, so this page is live
        the moment it merges — telling a rider to tap a control that does not exist is worse
        than not having the page. Delete this block when the Profile flow ships; the section
        below it is already written in the present tense for that day.

        It names a real address, because "contact us at the address you signed up through"
        named none and was ambiguous about whose address it meant. Play's User Data policy
        wants a web-accessible route to REQUEST deletion, and this paragraph is the only
        thing on the page that has to work for a reviewer.

        OWNER: replace this with a mailbox you actually monitor. `hello@` is a guess.
      */}
      <p className="font-medium text-foreground">
        The in-app control is not in the current build — it ships with the rest of the
        account-deletion release. Until then, email{' '}
        <a href="mailto:hello@letsride.app" className="underline">
          hello@letsride.app
        </a>{' '}
        from the address on your account and ask for it to be deleted.
      </p>

      <h2 className="font-semibold">Where to find it</h2>
      <p className="text-muted">
        Open <span className="font-medium">Profile</span>, then the menu, then{' '}
        <span className="font-medium">Delete account</span>, and confirm.
      </p>

      <h2 className="font-semibold">What is removed</h2>
      <p className="text-muted">
        Your profile, username, bio, motorcycle and location; every photo you uploaded,
        including your avatar and cover image; your postcards, comments and likes; your club
        memberships; your ride attendance; the countries you listed; and the accounts you
        blocked or hid.
      </p>
      <p className="text-muted">
        Your username becomes available for anyone else to take, and blocks you had placed on
        other riders are lifted along with everything else.
      </p>

      <h2 className="font-semibold">What happens to rides you organised</h2>
      <p className="text-muted">
        They are cancelled and disappear, along with their crew lists. Riders who had said
        they were going are not notified — the ride simply stops being there. Rides organised
        by other people are unaffected, including rides you had joined.
      </p>

      <h2 className="font-semibold">What happens to clubs you own</h2>
      <p className="text-muted">
        A club you own is handed to another member rather than deleted, so that other riders do
        not lose what they posted in it. It goes to the longest-standing admin, or if there is
        none, to the longest-standing member. The club keeps its name and its members, and
        loses its avatar and cover image.
      </p>
      <p className="text-muted">
        If no member is left, there is nobody to hand it to, so the club is deleted with you.
        Anything posted in it goes too — including posts by riders who joined, posted and left
        again, because leaving a club does not remove what you posted there. Public rides in
        that club survive and simply stop belonging to a club; private ones are deleted,
        because a private ride with no club is one nobody but its organiser could ever see
        again.
      </p>

      <h2 className="font-semibold">What is kept</h2>
      <p className="text-muted">
        Postcards, comments and rides created by other riders stay, wherever they are — except
        in the one case above, where a club is deleted because nobody is left to own it.
        Nothing that identifies you remains attached to any of it.
      </p>

      <p className="text-muted">
        See also our <Link href="/legal/terms" className="underline">Terms and Conditions</Link>{' '}
        and <Link href="/legal/privacy" className="underline">Privacy Statement</Link>.
      </p>
    </>
  )
}
