'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
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
 * the app would then have to model.
 *
 * The design has no frame for this screen — it did not exist when the login epic
 * was drawn. It reuses `AuthScreen` and the signup screen's own consent block
 * verbatim rather than inventing a composition, so there is nothing here for a
 * later design pass to unpick beyond the copy.
 */
export default function OnboardingTermsPage() {
  const [state, formAction, pending] = useActionState(acceptTerms, emptyActionState)
  const [accepted, setAccepted] = useState(false)

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
            <p className="text-center text-xs text-muted">
              Not ready?{' '}
              <Link href="/auth/login" className="underline">
                Sign out
              </Link>
              .
            </p>
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
