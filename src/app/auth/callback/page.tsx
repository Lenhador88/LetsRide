'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { createClient } from '@/lib/supabase/client'
import { safeNext } from '@/lib/auth/recovery'

/**
 * Exchanges a Supabase auth code for a session. Password recovery is what needs
 * it: the emailed link lands here, and without the exchange the reset page has
 * no session and cannot set a new password.
 *
 * **This was a Route Handler, and it had to be until now.** The exchange wrote
 * cookies, which a Server Component cannot do. The session no longer lives in a
 * cookie — see `lib/supabase/client.ts` — so the thing that forced a server
 * round trip is gone, and this is a page.
 *
 * `026`'s own header predicted this move exactly: "when the shell lands, this
 * whole handler is replaced by a client route doing the same exchange in the
 * browser, where the verifier will then be. Nothing about the grant changes with
 * it." Nothing has.
 *
 * ## Why the verifier is here now, and why it never could have been elsewhere
 *
 * The flow is PKCE. `resetPasswordForEmail` stores a `code_verifier` in the
 * storage of whichever client asked for the link, and `exchangeCodeForSession`
 * requires it back. That client used to be the app's *server* client, holding it
 * in the cookie jar — which is why `/auth/callback` worked, and why D3's
 * proposed Edge Function could not be built: a second server has no way to hold
 * it. Now the browser asks for the link and the browser exchanges it, so the
 * verifier is in one store throughout.
 *
 * It still sets no recovery marker and must not start: `026` moved that to the
 * `amr` claim GoTrue already puts in the access token, which the client cannot
 * forge. A second marker set here would be one the native shell cannot produce,
 * so the two paths would disagree about who may reset.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<SigningIn />}>
      <AuthCallback />
    </Suspense>
  )
}

function AuthCallback() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Read once into state rather than off `searchParams` each render: the effect
  // below navigates, and re-reading during the teardown render would restart the
  // exchange against a code already spent.
  const [code] = useState(() => searchParams.get('code'))
  const [next] = useState(() => safeNext(searchParams.get('next')))

  useEffect(() => {
    let cancelled = false

    if (!code) {
      router.replace('/auth/login?error=missing_code')
      return
    }

    createClient()
      .auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (cancelled) return
        // Recovery links are single-use and time-limited, so an expired or
        // reused link is the ordinary case here, not an exceptional one.
        router.replace(error ? '/auth/forgot-password?error=invalid_link' : next)
      })

    return () => {
      cancelled = true
    }
  }, [code, next, router])

  // Never on screen for long, and deliberately says nothing about which flow
  // brought the rider here — the same reasoning as the reset screen's single
  // expiry message. A recovery link and a future magic link land identically.
  return <SigningIn />
}

/**
 * `AuthScreen` requires children, and there is deliberately nothing to put in
 * them: this screen is a hop, not a destination. The title alone is the whole
 * message, and it says nothing about which flow brought the rider here — the
 * same reasoning as the reset screen's single expiry message. A recovery link
 * and a future magic link land identically.
 */
function SigningIn() {
  return (
    <AuthScreen title="Signing you in">
      <p className="text-sm text-muted">One moment.</p>
    </AuthScreen>
  )
}
