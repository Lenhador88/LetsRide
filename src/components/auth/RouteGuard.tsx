'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  needsOnboardingState,
  resolveDestination,
  type GuardState,
} from '@/lib/auth/guard'
import type { OnboardingState } from '@/types'

/**
 * The client route guard — `proxy.ts`'s decisions, applied in the browser
 * (task 5.1).
 *
 * It wraps the whole app in the root layout rather than the authenticated
 * layout, because three of the rules it enforces are about paths *outside*
 * `(app)`: bouncing a signed-in rider off `/auth/login`, sending an
 * un-onboarded one into the wizard, and resolving `/`.
 *
 * ## Why it renders a splash rather than the page underneath
 *
 * A guard that renders its children while it decides is not a guard — it is a
 * flash of the screen the rider was not supposed to see, followed by a
 * redirect. So there are exactly two states here: deciding, and allowed.
 *
 * **This is also the first time this app has had a boot window at all.** `/`'s
 * own doc comment records the reasoning for having no splash — "the Figma splash
 * is a timed loading frame for a client app with a boot window; an SSR app has
 * none, so rendering that markup here would only add an artificial delay". That
 * was right, and this change is precisely what makes it stop being right: the
 * session now has to be read out of local storage and the onboarding stamp
 * fetched before anything can render. The delay is real now, so the frame the
 * design already drew is what fills it — flat `Accent Brand/100`, per
 * CLAUDE.md's note that the splash is the one screen that is not the gradient.
 *
 * ## The SSR pass
 *
 * Everything under `(app)` is still server-rendered by Next until the shell
 * lands, and in that pass there is no session to read. So the first client
 * render always starts in `deciding` and resolves in an effect — which is the
 * same rule `lib/data/` obeys, for the same reason.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [allowed, setAllowed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    readGuardState(pathname).then((state) => {
      if (cancelled) return
      const destination = resolveDestination(pathname, state)
      if (destination === null) {
        setAllowed(pathname)
        return
      }
      // Not `setAllowed` — the rider is leaving, and marking this path allowed
      // first would render it for one frame before the navigation commits.
      setAllowed(null)
      router.replace(destination)
    })

    return () => {
      cancelled = true
    }
  }, [pathname, router])

  // Compared against the *current* pathname rather than held as a boolean: a
  // navigation re-runs the effect, and a boolean would still read `true` from
  // the previous route while the new one was being decided — which is the flash
  // this component exists to prevent, reintroduced one route later.
  if (allowed !== pathname) return <GuardSplash />

  return <>{children}</>
}

/**
 * Reads the two things the decision needs. Everything else about the guard is
 * pure and lives in `lib/auth/guard.ts`.
 *
 * `getSession()`, not `getUser()`. `getUser()` revalidates the token against
 * GoTrue on every call, which would put a network round trip in front of every
 * navigation — and it would buy nothing, because this guard is not a security
 * boundary (RLS is, and it verifies the signature itself on every query). A
 * forged local session reaches a screen where every read returns nothing.
 *
 * The onboarding stamp is read through `my_onboarding_state()` rather than a
 * table select because `025` revokes column SELECT on both stamps — a select
 * naming them answers 403, which the `unavailable` branch would read as a deploy
 * mismatch and bounce every signed-in rider out of every screen. The function
 * returns the three things this needs in one round trip.
 */
async function readGuardState(pathname: string): Promise<GuardState> {
  const supabase = createClient()

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return { kind: 'anonymous' }

  if (!needsOnboardingState(pathname)) return { kind: 'session' }

  const { data, error } = await supabase.rpc('my_onboarding_state').maybeSingle<OnboardingState>()
  if (error || !data) return { kind: 'unavailable' }

  return { kind: 'rider', ...data }
}

/**
 * `v2 / Component / Splash` — flat `Accent Brand/100`, not the app gradient.
 *
 * `role="status"` with a label rather than a visible spinner: on a warm cache
 * this is on screen for a frame or two, and an animation that brief reads as a
 * flicker rather than as progress.
 */
function GuardSplash() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="bg-accent fixed inset-0 flex items-center justify-center"
    >
      <Image
        src="/brand/logo-splash.png"
        alt=""
        width={160}
        height={160}
        priority
        className="h-40 w-40 object-contain"
      />
    </div>
  )
}
