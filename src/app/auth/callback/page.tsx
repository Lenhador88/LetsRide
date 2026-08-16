'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { createClient } from '@/lib/supabase/client'
import {
  RECOVERY_PATH,
  callbackFailureDestination,
  hasPasswordResetGrant,
  safeNext,
} from '@/lib/auth/recovery'

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
  // GoTrue redirects here with `error`/`error_code` and no `code` when it
  // refuses the link itself — expired, already spent, or never valid. That is
  // a distinct case from an exchange that fails below, and it used to be read
  // as "no code" and sent to a login screen that rendered nothing (PD-225).
  const [refused] = useState(() => searchParams.get('error') !== null)

  useEffect(() => {
    let cancelled = false

    // Links are single-use and time-limited in both flows, so a spent or
    // expired one is the ordinary case here, not an exceptional one.
    if (refused || !code) {
      router.replace(callbackFailureDestination(next))
      return
    }

    createClient()
      .auth.exchangeCodeForSession(code)
      .then(async ({ error }) => {
        if (cancelled) return
        if (error) {
          router.replace(callbackFailureDestination(next))
          return
        }
        // `next` survives GoTrue's redirect on both flows, so this is the
        // ordinary path. The grant read below is the fallback for a link whose
        // query was stripped or refused by the open-redirect guard.
        if (next) {
          router.replace(next)
          return
        }

        // Ask what this session actually is rather than guessing from a
        // constant. A session minted from a recovery link carries `026`'s
        // grant and the client cannot forge it; anything else is a confirmed
        // sign-in, and the route guard resumes onboarding from /postcards if
        // the account is new.
        const recovering = await hasPasswordResetGrant(createClient())
        if (cancelled) return
        router.replace(recovering ? RECOVERY_PATH : '/postcards')
      })

    return () => {
      cancelled = true
    }
  }, [code, next, refused, router])

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
