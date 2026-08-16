'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { createClient } from '@/lib/supabase/client'
import { callbackFailureDestination, confirmableOtpType, safeNext } from '@/lib/auth/recovery'

/**
 * Confirms a signup from an emailed `token_hash`, on **any** device.
 *
 * ## Why this route exists beside `/auth/callback`
 *
 * The callback is PKCE. `signUp` stores a `code_verifier` in the storage of the
 * browser that signed up, and `exchangeCodeForSession` requires it back — so a
 * confirmation link opened anywhere else **cannot** succeed. That is not a bug
 * to fix in the callback; it is what binding a code to a verifier means.
 *
 * It fails in the worst possible way, too: GoTrue's `/verify` **spends the
 * token** before redirecting, so the account ends up confirmed and the link
 * ends up dead. PD-225 made that state say something useful ("sign in"); it
 * could not make the link work.
 *
 * `verifyOtp` needs no verifier. The hash in the URL is the whole credential,
 * so the phone that opens the mail is as good as the laptop that signed up.
 *
 * ## This route is inert until the email template changes, and that ordering is
 * deliberate
 *
 * Nothing links here yet. GoTrue builds the confirmation link from the *Confirm
 * signup* template, which is a dashboard setting, so switching it is an owner
 * action and it must happen **after** this deploys — a template pointing at a
 * route that does not exist yet breaks every confirmation in flight, and the
 * rider cannot retry a spent link. The reverse order costs nothing: this route
 * simply sits unvisited.
 *
 * The template it wants, verbatim:
 *
 * ```html
 * <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/postcards">
 *   Confirm your email
 * </a>
 * ```
 *
 * `{{ .SiteURL }}` rather than `{{ .RedirectTo }}`: each project's Site URL
 * already points at its own host (PD-106), and `.RedirectTo` would need the
 * query concatenated onto a value that already carries one.
 *
 * **`/auth/callback` stays.** Password recovery is still PKCE and still needs
 * it, and any confirmation link already in a rider's inbox still points there.
 */
export default function AuthConfirmPage() {
  return (
    <Suspense fallback={<Confirming />}>
      <AuthConfirm />
    </Suspense>
  )
}

function AuthConfirm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Read once into state for the same reason the callback does: the effect
  // navigates, and re-reading during the teardown render would verify a hash
  // that has already been spent.
  const [tokenHash] = useState(() => searchParams.get('token_hash'))
  const [type] = useState(() => confirmableOtpType(searchParams.get('type')))
  const [next] = useState(() => safeNext(searchParams.get('next')))

  useEffect(() => {
    let cancelled = false

    // A refused link redirects here with its error in the fragment and no
    // `token_hash` — the same shape the callback meets, measured in PD-225.
    // An unrecognised `type` lands here too, which is what `confirmableOtpType`
    // returning null means.
    if (!tokenHash || !type) {
      router.replace(callbackFailureDestination(next))
      return
    }

    createClient()
      .auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ error }) => {
        if (cancelled) return
        if (error) {
          router.replace(callbackFailureDestination(next))
          return
        }
        // No grant read here, unlike the callback. This route confirms an
        // email and nothing else — `confirmableOtpType` refuses `recovery`
        // outright — so there is no flow whose destination has to be asked
        // about. A confirmed rider goes to the app, and the route guard
        // resumes onboarding from there if the account is new.
        router.replace(next ?? '/postcards')
      })
      // Without this a rejection leaves the rider on "Confirming your email"
      // for ever: nothing re-renders, so there is no navigation to be had and
      // only a reload escapes.
      .catch(() => {
        if (!cancelled) router.replace(callbackFailureDestination(next))
      })

    return () => {
      cancelled = true
    }
  }, [next, router, tokenHash, type])

  return <Confirming />
}

function Confirming() {
  return (
    <AuthScreen title="Confirming your email">
      <p className="text-sm text-muted">One moment.</p>
    </AuthScreen>
  )
}
