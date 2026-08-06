'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import { hasPasswordResetGrant } from '@/lib/auth/recovery'
import { createClient } from '@/lib/supabase/client'

/**
 * The expired / already-used-link case (§States, no variant drawn) is caught
 * before a hydrated form renders, rather than letting the rider fill in a
 * password the action is guaranteed to refuse. `updatePassword` re-checks for
 * the narrower race where the grant is spent between this check and the submit.
 *
 * ## Why this is a client page, and why the check is in an effect
 *
 * It was the auth group's only server page, and it was one for exactly one
 * reason: it read the httpOnly `lr-recovery` cookie, which only a server
 * component could see. Migration `026` replaced that cookie with a claim in the
 * access token, readable by whoever holds the session — which is what let this
 * screen move (tasks 4.4 and 4.7 are one piece of work, not two).
 *
 * The read is in an effect because a `'use client'` page is still
 * server-rendered until Phase 6, and in that pass the browser client has no
 * `document.cookie` to find a session in. A check issued from the component
 * body would run anonymous, `anon` holds no grant on the function, and every
 * rider would be told their link had expired. Same rule as `lib/data/`, and the
 * failure is a runtime one that tsc, ESLint and `next build` all stay green
 * through.
 *
 * Three states, and `checking` is a real one rather than an optimistic guess:
 * rendering the form first and retracting it would flash a form at a rider who
 * cannot use it, and rendering the refusal first would flash a dead end at the
 * one who can.
 */
export default function ResetPasswordPage() {
  const [grant, setGrant] = useState<'checking' | 'granted' | 'expired'>('checking')

  useEffect(() => {
    let cancelled = false
    hasPasswordResetGrant(createClient()).then((granted) => {
      if (!cancelled) setGrant(granted ? 'granted' : 'expired')
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (grant === 'granted') return <ResetPasswordForm />

  return (
    <AuthScreen title="Create new password">
      {grant === 'expired' && (
        <p className="text-sm text-muted">
          That reset link has expired or was already used.{' '}
          <Link href="/auth/forgot-password" className="font-medium text-foreground underline">
            Request a new one
          </Link>
          .
        </p>
      )}
    </AuthScreen>
  )
}
