'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { requestPasswordReset } from '@/lib/actions/auth'
import { emptyActionState } from '@/lib/actions/state'
import { retaining, seedRetained } from '@/lib/actions/retain'

const BACK = { href: '/auth/login', label: 'Back to login' }

// Only the validation refusal is ever seen here — the action reports success
// whatever the address turns out to be (Q16) — but that refusal is exactly the
// one where retyping the address is wasted work. See lib/actions/retain.ts.
const retainEmail = retaining(requestPasswordReset, ['email'])
const initialState = seedRetained(emptyActionState)

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(retainEmail, initialState)

  // requestPasswordReset never reveals whether the address exists (Q16), so
  // its success and its unsubmitted initial state would otherwise both read as
  // `{ error: null }`. The action sets `sent` to distinguish them by value —
  // comparing object identity against the seed worked, but only for as long as
  // that seed stayed a shared singleton.
  const submitted = state.sent === true

  if (submitted) {
    return (
      <AuthScreen title="Reset password" back={BACK}>
        <p className="text-sm text-muted">
          If an account exists for that address, we&apos;ve sent reset instructions.
        </p>
      </AuthScreen>
    )
  }

  return (
    <form action={formAction}>
      <AuthScreen
        title="Reset password"
        body="Enter the email associated with your account and we'll send an email with instructions to reset you password."
        back={BACK}
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
        </div>
        <div className="flex flex-col gap-2">
          <FormError message={state.error} />
          <Button type="submit" size="lg" loading={pending}>
            Send instructions
          </Button>
        </div>
      </AuthScreen>
    </form>
  )
}
