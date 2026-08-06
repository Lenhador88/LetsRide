'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { signUp } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { NEW_PASSWORD_MIN_LENGTH } from '@/lib/validation/auth'

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signUp, emptyActionState)
  useActionRedirect(state)
  const [accepted, setAccepted] = useState(false)

  // `signUp` sets `sent` when the account was created but no session came back,
  // which is what Supabase returns while email confirmation is on. There is
  // nowhere to navigate to in that case — every route past here needs a session
  // — so the screen reports what happened instead of `useActionRedirect`
  // carrying the rider to an onboarding step the route guard would bounce them
  // straight back off.
  //
  // The copy names no address and does not say whether one already existed:
  // with confirmation on, GoTrue answers a duplicate signup with this same
  // shape precisely so the form cannot be used to discover who has an account.
  if (state.sent === true) {
    return (
      <AuthScreen title="Check your email" back={{ href: '/auth/login', label: 'Back to login' }}>
        <p className="text-sm text-muted">
          We&apos;ve sent you a link to confirm your address. Open it, then sign in to finish
          setting up your profile.
        </p>
      </AuthScreen>
    )
  }

  return (
    <form action={formAction}>
      <AuthScreen title="Sign up" back={{ href: '/auth/login', label: 'Back to login' }}>
        <div className="flex flex-col gap-2">
          <Input
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            inputMode="email"
            enterKeyHint="next"
            required
          />
          <div className="flex flex-col gap-1.5">
            <Input
              name="password"
              type="password"
              label="Password"
              autoComplete="new-password"
              enterKeyHint="done"
              minLength={NEW_PASSWORD_MIN_LENGTH}
              required
            />
            <p className="px-1 text-xs text-muted">At least {NEW_PASSWORD_MIN_LENGTH} characters.</p>
          </div>
        </div>
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
        <div className="flex flex-col gap-2">
          <FormError message={state.error} />
          <Button type="submit" size="lg" loading={pending} disabled={!accepted}>
            Sign up
          </Button>
        </div>
      </AuthScreen>
    </form>
  )
}
