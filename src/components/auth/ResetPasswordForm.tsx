'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updatePassword } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { retaining, seedRetained } from '@/lib/actions/retain'
import { NEW_PASSWORD_MIN_LENGTH } from '@/lib/validation/auth'

/**
 * No back link (Q Screens note: entered from an email deep link, not from
 * within the app) and no confirm-password field (Q15).
 */
// Retained for the length refusal, which is the one a rider can act on without
// leaving: an expired grant sends them back for a new link either way.
const retainPassword = retaining(updatePassword, ['password'])
const initialState = seedRetained(emptyActionState)

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(retainPassword, initialState)
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
            defaultValue={state.retained.password}
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
