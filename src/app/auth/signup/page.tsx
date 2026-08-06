'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { signUp } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signUp, emptyActionState)
  useActionRedirect(state)
  const [accepted, setAccepted] = useState(false)

  return (
    <form action={formAction}>
      <AuthScreen title="Sign up" back={{ href: '/auth/login', label: 'Back to login' }}>
        <div className="flex flex-col gap-2">
          <Input name="email" type="email" label="Email" autoComplete="email" required />
          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="rounded-lg bg-background p-4">
          <Checkbox
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
