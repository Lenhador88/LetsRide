'use client'

import { useActionState, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { signIn } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'

/**
 * **The email field is controlled, and that is what keeps it filled after a
 * refused sign-in (PD-196).**
 *
 * React resets a `<form action={fn}>` once the action resolves — literally
 * `form.reset()` in the commit phase — so every *uncontrolled* field reverts to
 * its `defaultValue`, which here is the empty string. A rider who mistyped
 * their password got a form with no email in it either, and had to retype an
 * address the app had just been told. Nothing in this repo cleared it; the
 * framework did, on the success path and the failure path alike, because it
 * cannot know which one this was.
 *
 * A controlled input is React's own escape hatch rather than a trick: it keeps
 * the DOM node's `defaultValue` in sync with the `value` prop on every update,
 * so the reset restores the value that is already there.
 *
 * **The password is left uncontrolled on purpose** — it is the field that was
 * wrong, clearing it is what every other sign-in form does, and a rejected
 * password sitting in the box invites a second identical submit.
 */
export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, emptyActionState)
  const [email, setEmail] = useState('')
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
