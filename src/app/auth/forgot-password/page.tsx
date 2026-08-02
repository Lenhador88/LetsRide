'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { emptyActionState, requestPasswordReset } from '@/lib/actions/auth'

const BACK = { href: '/auth/login', label: 'Back to login' }

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, emptyActionState)

  // requestPasswordReset never reveals whether the address exists (Q16), so
  // its success and its unsubmitted initial state are both `{ error: null }`.
  // The two are told apart by reference, not value: the action always
  // returns a fresh object, while the untouched form still holds the exact
  // `emptyActionState` singleton it was seeded with.
  const submitted = state !== emptyActionState && !state.error

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
          <Input name="email" type="email" label="Email" autoComplete="email" required />
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
