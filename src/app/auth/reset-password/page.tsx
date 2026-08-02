import { cookies } from 'next/headers'
import Link from 'next/link'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import { RECOVERY_COOKIE } from '@/lib/auth/recovery'

/**
 * A server component so the expired/already-used-link case (§States, no
 * variant drawn) is caught before a hydrated form ever renders, rather than
 * letting the rider fill in a password the action is guaranteed to refuse.
 * `updatePassword` re-checks the same cookie server-side for the narrower
 * race where it expires between this render and the submit.
 */
export default async function ResetPasswordPage() {
  const cookieStore = await cookies()
  const hasRecoverySession = Boolean(cookieStore.get(RECOVERY_COOKIE))

  if (!hasRecoverySession) {
    return (
      <AuthScreen title="Create new password">
        <p className="text-sm text-muted">
          That reset link has expired or was already used.{' '}
          <Link href="/auth/forgot-password" className="font-medium text-foreground underline">
            Request a new one
          </Link>
          .
        </p>
      </AuthScreen>
    )
  }

  return <ResetPasswordForm />
}
