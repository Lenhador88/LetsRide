'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updatePassword } from '@/lib/actions/auth'
import { emptyActionState } from '@/lib/actions/state'

/**
 * No back link (Q Screens note: entered from an email deep link, not from
 * within the app) and no confirm-password field (Q15).
 */
export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, emptyActionState)

  return (
    <form action={formAction}>
      <AuthScreen title="Create new password">
        <div className="flex flex-col gap-2">
          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            minLength={8}
            required
          />
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
