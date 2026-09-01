'use client'

import Link from 'next/link'

import { SUPPORT_EMAIL } from '@/lib/support'

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
 * `supabase/tests/rls_test.sql` asserts. **Nothing on it is time-sensitive any
 * more** — the one sentence that was, "the in-app control is not in the current
 * build", outlived its truth on a live page and is gone; a claim that flips on
 * a merge nobody re-reads is the shape to keep off this page.
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
        The paragraph that used to sit here said the in-app control "is not in the current
        build". It shipped with PD-102 and `ProfileMenu` renders `Delete account`
        unconditionally, so the sentence became false on a page `main` auto-deploys — the
        exact failure its own comment predicted and asked the next session to delete.

        What is kept is the emailed route, in the present tense, because it answers a
        different rider: one who cannot sign in at all. Play's User Data policy wants a
        web-accessible way to REQUEST deletion, and "open the app and tap it" is not one for
        somebody locked out of the account. The address is `SUPPORT_EMAIL` — see that file
        for why it still needs an owner.
      */}
      <p className="text-muted">
        If you cannot sign in — a lost password, an email address you no longer have — email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
          {SUPPORT_EMAIL}
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

      {/* PD-353. The list above is an enumeration of what the cascade removes,
          and a rider reading it will reasonably take it as "everything,
          everywhere" — which stopped being true the moment usage analytics
          shipped. `delete-account` removes the auth user and the database rows
          cascade from it; PostHog is a separate processor and the function does
          not reach it, so the recordings and events survive. Wiring that is an
          open item on PD-353 and needs a secret this function does not hold.

          Named here rather than left to the privacy page because THIS is the
          page a rider reads when they are deciding to leave. */}
      <p className="text-muted">
        One thing is not removed automatically: the usage records and screen replays described
        in our{' '}
        <Link href="/legal/privacy" className="underline">
          Privacy Statement
        </Link>
        . They are held by a separate company and deleting your account does not reach them.
        Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
          {SUPPORT_EMAIL}
        </a>{' '}
        and ask, and we will have them deleted.
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
