'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { signIn } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState, type ActionState } from '@/lib/actions/state'

/** `signIn`'s state plus the address the last submit actually carried. */
type LoginFormState = ActionState & { email: string }

const initialState: LoginFormState = { ...emptyActionState, email: '' }

/**
 * **A refused sign-in must leave the email in the field (PD-196), and the form
 * puts it back rather than trying to stop React taking it away.**
 *
 * React resets a `<form action={fn}>` once the action resolves — `form.reset()`
 * in the commit phase — so every *uncontrolled* field reverts to its
 * `defaultValue`. That runs on the failure path as well as the success one,
 * because React cannot know which one it was, and the email's `defaultValue`
 * was the empty string. A rider who mistyped their password had to retype an
 * address the app had just been handed.
 *
 * **So the reset is aimed rather than fought**: the wrapper below records what
 * `formData` actually carried, and that becomes the field's `defaultValue` — so
 * `form.reset()` restores the submitted address instead of erasing it.
 *
 * ## Why not simply make the field controlled
 *
 * That is React's documented escape hatch, it fixes the typed case, and it was
 * this fix's first shape. **It breaks the rider this story is about.** A
 * password manager fills the field by assigning the DOM value; if that fill
 * lands before hydration — or dispatches no `input` event React is listening
 * for — `useState('')` never learns about it, and `updateInput` compares its
 * prop against the *live DOM value* and overwrites it on the next render. The
 * `pending` flip from `useActionState` is that render, so the field empties on
 * click, one submit earlier than the bug being fixed. Measured in Chromium
 * against DEV, not reasoned about: a value assigned with no `input` event is
 * gone by the time the refusal is drawn.
 *
 * `defaultValue` has no such failure. React writes an uncontrolled input's
 * value only during the reset, and `formData` is read from the DOM at submit
 * time — so whatever put the address there, typing or autofill, is what comes
 * back.
 *
 * **The password is deliberately left out of this.** It is the field that was
 * wrong, clearing it is what every other sign-in form does, and a rejected
 * password sitting in the box invites a second identical submit.
 */
export default function LoginPage() {
  // A wrapper rather than a change to `signIn`: the action is a plain async
  // function that a test and an event handler call the same way, and what the
  // form needs to redraw itself is this screen's business, not the mutation's.
  // `/onboarding/username` carries its refusal list the same way.
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    async (previous, formData) => ({
      ...(await signIn(previous, formData)),
      email: String(formData.get('email') ?? ''),
    }),
    initialState
  )
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
            defaultValue={state.email}
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
