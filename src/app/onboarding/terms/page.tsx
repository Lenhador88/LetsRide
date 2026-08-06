'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { useActionRedirect, useSignOut } from '@/lib/actions/navigate'
import { acceptTerms } from '@/lib/actions/onboarding'
import { emptyActionState } from '@/lib/actions/state'

/**
 * The consent prompt, for a rider whose `terms_accepted_at` is NULL.
 *
 * **Not a step in the wizard**, which is why it carries no `<Pagination>` and no
 * step count. `signUp` records consent the instant the account exists, so every
 * rider who arrives through the current flow skips this screen entirely; it is
 * reached only by the four accounts that predate that write, all documented in
 * docs/HANDOFF.md. Q11 chose a prompt over a backfill — a fabricated consent
 * record is worse than a missing one — and chose one screen over a flow, because
 * a rollout for a population of four is a rollout for nobody.
 *
 * There is no decline affordance and no skip, matching decision #5. Declining is
 * signing out, which the copy says plainly rather than dressing up as a choice
 * the app would then have to model — and it calls `signOut` rather than linking
 * to `/auth/login`, which the guard bounces straight back here.
 *
 * The design has no frame for this screen — it did not exist when the login epic
 * was drawn. It reuses `AuthScreen` and the signup screen's own consent block
 * verbatim rather than inventing a composition, so there is nothing here for a
 * later design pass to unpick beyond the copy.
 */
export default function OnboardingTermsPage() {
  const [state, formAction, pending] = useActionState(acceptTerms, emptyActionState)
  const [accepted, setAccepted] = useState(false)
  const { signOut, pending: signingOut } = useSignOut()
  useActionRedirect(state)

  return (
    <form action={formAction}>
      <AuthScreen
        title="Before you ride"
        body="We have updated how we record your agreement to our terms. Accept them to carry on using Lets Ride."
        footer={
          <div className="flex flex-col gap-2">
            <FormError message={state.error} />
            <Button type="submit" size="lg" loading={pending} disabled={!accepted}>
              Accept and continue
            </Button>
            {/* `formAction` rather than a link, because a link here was a dead
                end: /auth/login is an auth entry path, so the guard does not
                short-circuit it, and a rider with no consent stamp was bounced
                straight back to this screen — still signed in, with no other way
                out, since /onboarding has no Navbar. This screen exists only for
                riders in exactly that state, so the affordance failed for every
                rider who could see it. */}
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="text-center text-sm font-medium text-foreground underline underline-offset-2 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {signingOut ? 'Signing out…' : 'Not ready? Sign out'}
            </button>
          </div>
        }
      >
        <div className="rounded-lg bg-background p-4">
          <Checkbox
            name="acceptedTerms"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            label={
              <>
                I agree to the Lets Ride{' '}
                <Link href="/legal/terms" className="underline">
                  terms and conditions
                </Link>{' '}
                and{' '}
                <Link href="/legal/privacy" className="underline">
                  privacy statement
                </Link>
                .
              </>
            }
          />
        </div>
      </AuthScreen>
    </form>
  )
}
