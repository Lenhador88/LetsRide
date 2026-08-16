'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { signOut } from '@/lib/actions/auth'
import { CONFIRM_FAILURE_PATH, confirmableOtpType, safeNext } from '@/lib/auth/recovery'

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
 * action and it must happen **after** this deploys. Template-first sends every
 * rider to a 404 (or, before this route is public, to a guard bounce) — **not
 * an unrecoverable one, and the distinction decides the rollback plan**: only
 * `verifyOtp` spends a `token_hash`, and neither of those calls it, so the link
 * keeps working for the rest of GoTrue's OTP lifetime and succeeds the moment
 * the route lands. Deploy-first is still right; it just costs a window of
 * confusing failures rather than a cohort of dead accounts.
 *
 * The reverse order costs nothing at all: this route simply sits unvisited.
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

type Outcome = 'confirmed' | 'held-session' | 'failed'

/**
 * One verification per token hash, for the lifetime of the page.
 *
 * **StrictMode is ON** — `next.config.ts` leaves `reactStrictMode` unset and
 * Next resolves that to enabled for the App Router — so in `npm run dev` the
 * effect below mounts, tears down and mounts again. `cancelled` suppresses the
 * first run's *navigation*, never its *request*, so without this latch two
 * `verifyOtp` calls race for a single-use token and the one that navigates is
 * usually the loser: the rider sees "that confirmation link has expired" on a
 * link that just worked. That is exactly the manual test somebody will run
 * before flipping the email template (PD-233).
 *
 * Caching the promise rather than a "done" flag is what makes the second mount
 * *reuse* the first's answer instead of skipping and hanging. A rejection stays
 * cached on purpose — clearing the slot would re-open the double-spend — and a
 * full reload gets a fresh module scope, which is the only retry that makes
 * sense for a token this may already have burned.
 */
const verifications = new Map<string, Promise<Outcome>>()

function verifyOnce(tokenHash: string, type: 'signup' | 'email'): Promise<Outcome> {
  let pending = verifications.get(tokenHash)
  if (!pending) {
    pending = (async () => {
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      if (data.session) return 'held-session'
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      return error ? 'failed' : 'confirmed'
    })()
    verifications.set(tokenHash, pending)
  }
  return pending
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
  const [heldSession, setHeldSession] = useState(false)

  useEffect(() => {
    let cancelled = false

    // A refused link redirects here with its error in the fragment and no
    // `token_hash` — the same shape the callback meets, measured in PD-225.
    // An unrecognised `type` lands here too, which is what `confirmableOtpType`
    // returning null means.
    //
    // **The destination is unconditional, unlike the callback's.** That route
    // carries recovery as well as confirmation and has to tell them apart;
    // this one refuses `recovery` at `confirmableOtpType`, so discriminating
    // on `next` here could only ever fire wrongly — a hand-edited
    // `?next=/auth/reset-password` would route a failed CONFIRMATION into
    // password recovery, which is the exact defect PD-225 removed.
    if (!tokenHash || !type) {
      router.replace(CONFIRM_FAILURE_PATH)
      return
    }

    // **Refuse to spend a token into a browser that already holds a session.**
    // `verifyOtp` takes a bearer credential — the hash in the URL is the whole
    // thing, which is what makes cross-device work — so without this check an
    // attacker can send a signed-in rider a link carrying the attacker's OWN
    // confirmation token and silently swap the session: `onAuthStateChange`
    // fires, `guard-cache` takes the new user id, and every postcard, photo
    // and ride the victim then writes lands in the attacker's account. It is
    // login CSRF, and `/auth/callback` was structurally immune to it because
    // PKCE requires a verifier out of the victim's own storage.
    //
    // Refusing costs nothing real: with confirmation ON a rider being
    // confirmed has no session by construction, and the token is NOT spent
    // here — they can sign out and click the same link again.
    verifyOnce(tokenHash, type)
      .then((outcome) => {
        if (cancelled) return
        if (outcome === 'held-session') {
          setHeldSession(true)
          return
        }
        // No grant read here, unlike the callback. This route confirms an
        // email and nothing else, so there is no flow whose destination has to
        // be asked about. A confirmed rider goes to the app, and the route
        // guard resumes onboarding from there if the account is new.
        router.replace(outcome === 'confirmed' ? (next ?? '/postcards') : CONFIRM_FAILURE_PATH)
      })
      // Without this a rejection leaves the rider on "Confirming your email"
      // for ever: nothing re-renders, so there is no navigation to be had and
      // only a reload escapes.
      .catch(() => {
        if (!cancelled) router.replace(CONFIRM_FAILURE_PATH)
      })

    return () => {
      cancelled = true
    }
  }, [next, router, tokenHash, type])

  if (heldSession) return <AlreadySignedIn />

  return <Confirming />
}

/**
 * The refusal above, on screen. The token is still unspent, so signing out and
 * returning to this same URL confirms the account for real — hence the reload
 * rather than a redirect, which would drop the `token_hash`.
 */
function AlreadySignedIn() {
  const [signingOut, setSigningOut] = useState(false)

  return (
    <AuthScreen
      title="You're already signed in"
      body="This confirmation link is for a different account. Sign out and we'll open it again."
    >
      <Button
        size="lg"
        loading={signingOut}
        onClick={() => {
          setSigningOut(true)
          signOut().then(() => window.location.reload())
        }}
      >
        Sign out and confirm
      </Button>
    </AuthScreen>
  )
}

function Confirming() {
  return (
    <AuthScreen title="Confirming your email">
      <p className="text-sm text-muted">One moment.</p>
    </AuthScreen>
  )
}
