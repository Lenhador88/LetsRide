'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { signIn } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { retaining, seedRetained } from '@/lib/actions/retain'

const retainEmail = retaining(signIn, ['email'])
const initialState = seedRetained(emptyActionState)

/**
 * **A refused sign-in must leave the email in the field — PD-196.** React
 * resets a `<form action={fn}>` on the error return as readily as on the
 * success one; `lib/actions/retain.ts` carries the mechanism, why the value is
 * put back rather than held in component state, and what a password manager
 * does to the version that holds it.
 *
 * **The password is deliberately not retained here, and this is the screen that
 * decides it.** The only error `signIn` returns means that password was
 * refused, so keeping it invites an identical resubmit — where `/auth/signup`
 * keeps its own, the error there usually being about the email.
 */
export default function LoginPage() {
  const [state, formAction, pending] = useActionState(retainEmail, initialState)
  useActionRedirect(state)

  return (
    <form action={formAction}>
      <AuthScreen
        title="Login"
        footer={
          <Button href="/auth/signup" variant="secondary" size="md">
            Sign up
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <Input
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
            defaultValue={state.retained.email}
          />
          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <FormError message={state.error} />
          <Button type="submit" size="lg" loading={pending}>
            Login
          </Button>
          <Button href="/auth/forgot-password" variant="secondary" size="md">
            Forgot password?
          </Button>
        </div>
      </AuthScreen>
    </form>
  )
}
