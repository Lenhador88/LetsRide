'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updatePassword } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { NEW_PASSWORD_MIN_LENGTH } from '@/lib/validation/auth'

/**
 * No back link (Q Screens note: entered from an email deep link, not from
 * within the app) and no confirm-password field (Q15).
 */
export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, emptyActionState)
  useActionRedirect(state)

  return (
    <form action={formAction}>
      <AuthScreen title="Create new password">
        <div className="flex flex-col gap-2">
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
        <div className="flex flex-col gap-2">
          <FormError message={state.error} />
          <Button type="submit" size="lg" loading={pending}>
            Save password
          </Button>
        </div>
      </AuthScreen>
    </form>
  )
}
