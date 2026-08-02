'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { emptyActionState } from '@/lib/actions/auth'
import { setLocation } from '@/lib/actions/onboarding'

/**
 * Step 2 of 2 — the last step now that the photo step is deferred, so this
 * is what commits `onboarding_completed_at` (see setLocation) and its primary
 * reads "Finish" rather than the design's "Next": with no step after it,
 * "Next" would promise a screen that no longer exists.
 */
export default function OnboardingLocationPage() {
  const [state, formAction, pending] = useActionState(setLocation, emptyActionState)

  return (
    <form action={formAction}>
      <AuthScreen
        title="Where are you located?"
        back={{ href: '/onboarding/username', label: 'Back' }}
        footer={
          <div className="flex flex-col gap-6">
            <Pagination total={2} current={1} />
            <div className="flex flex-col gap-2">
              <FormError message={state.error} />
              <Button type="submit" size="lg" loading={pending}>
                Finish
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          <Input name="location" label="City" autoComplete="address-level2" required />
        </div>
      </AuthScreen>
    </form>
  )
}
