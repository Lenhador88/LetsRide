'use client'

import { useActionState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { signIn } from '@/lib/actions/auth'
import { emptyActionState } from '@/lib/actions/state'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, emptyActionState)

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
          <Input name="email" type="email" label="Email" autoComplete="email" required />
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
