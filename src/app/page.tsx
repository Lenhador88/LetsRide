'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { bootRestoreTarget, restoreAlreadyAttempted } from '@/lib/native/boot-restore'

/**
 * `/` is a resolver, not a screen (Q7/Q18) — and it is now a resolver that
 * resolves nothing itself.
 *
 * It used to be a server page that read the session and `redirect()`ed. The
 * route guard makes the same decision for every path in the app, including this
 * one (`resolveDestination('/', …)` → `/postcards` for an onboarded rider,
 * `/auth/login` for a visitor, and the resume step for a rider mid-wizard —
 * which the old version got wrong, sending them to `/postcards` for `proxy.ts`
 * to bounce again). Duplicating that here would be a second copy of a rule with
 * its own opinion about the wizard.
 *
 * So this renders nothing, and on the web nothing is ever seen: the guard shows
 * the splash until it has decided, and it has always decided to leave.
 *
 * **The splash frame the original comment ruled out now exists**, and this is
 * what changed. That comment's reasoning — "the Figma splash is a timed loading
 * frame for a client app with a boot window; an SSR app has none, so rendering
 * that markup here would only add an artificial delay" — was right for a server
 * render and is exactly wrong for this one. Reading a session out of local
 * storage and fetching the onboarding stamp is a real boot window. It is drawn
 * by `RouteGuard`, not here, because every route has it and not just this one.
 *
 * ## The one thing it does do, and only inside the native shell
 *
 * Capacitor serves the **root** document for every extensionless path, so a cold
 * start at a deep link boots `/`'s tree at somebody else's URL — and this
 * component mounting is exactly how that is detected, because `/`'s page renders
 * only when `/`'s tree is the tree that rendered. `bootRestoreTarget` carries the
 * measurement and the negative cases; on the web it answers `null` every time,
 * because a deployment serves `/`'s document for `/` and for nothing else.
 */

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const target = bootRestoreTarget(window.location)
    if (!target) return
    if (restoreAlreadyAttempted(window.sessionStorage, target)) return
    // `replace`, never `push`: the root document was never a screen the rider
    // asked for, and leaving it in history puts a blank page behind the back
    // button on the first thing they opened.
    router.replace(target)
  }, [router])

  return null
}
