'use client'

import Link from 'next/link'
import { useActionState, useRef, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { signUp } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { retaining, seedRetained, useRestoreChecked } from '@/lib/actions/retain'
import { NEW_PASSWORD_MIN_LENGTH } from '@/lib/validation/auth'

// **The password is retained here and not on `/auth/login`.** The error a
// rider actually hits on this screen is about the *email* — already registered
// — so clearing a password they got right, and which has a length rule to
// satisfy, is pure cost. `signIn`'s only error means the password itself was
// refused, which is why that screen drops it.
const retainCredentials = retaining(signUp, ['email', 'password'])
const initialState = seedRetained(emptyActionState)

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(retainCredentials, initialState)
  useActionRedirect(state)
  const [accepted, setAccepted] = useState(false)
  // The other two controlled checkboxes in the app restore because a refused
  // retry would silently re-publish something private. This one is worse than
  // that: `form.reset()` puts the box back to its mount-time `checked`
  // attribute — `false`, because nobody has ever opened this screen with it
  // ticked — while `accepted` still says `true`. So the retry after any
  // refusal is rejected by `signUpSchema` on a box the rider never unticked,
  // and `disabled={!accepted}` reads the state that still agrees with them, so
  // the one affordance that would hint at it never fires.
  const acceptedRef = useRef<HTMLInputElement>(null)
  useRestoreChecked(acceptedRef, accepted, state)

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
            defaultValue={state.retained.email}
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
              defaultValue={state.retained.password}
            />
            <p className="px-1 text-xs text-muted">At least {NEW_PASSWORD_MIN_LENGTH} characters.</p>
          </div>
        </div>
        <div className="rounded-lg bg-background p-4">
          <Checkbox
            ref={acceptedRef}
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
