'use client'

import { useEffect, useSyncExternalStore } from 'react'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { resolveDestination } from '@/lib/auth/guard'
import {
  attachGuardAuthListener,
  ensureGuardState,
  getGuardSnapshot,
  getServerGuardSnapshot,
  guardStateFrom,
  hasGuardBooted,
  subscribeGuardCache,
} from '@/lib/auth/guard-cache'

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
 * ## The decision is synchronous after the first one (PD-111)
 *
 * The state behind it lives in `lib/auth/guard-cache.ts` and is held across
 * navigations, so a tab tap resolves in the same tick and the splash never
 * paints again. It used to resolve in an effect keyed on `pathname`, which meant
 * every navigation drew the full-screen green for a round trip to `eu-west-1`
 * and unmounted `(app)/layout.tsx` — bottom bar and background included — on the
 * way. See that module's header for what is cached and who writes it.
 *
 * **Boot replaces `children`; a later wait overlays them.** The two are not
 * stylistic variants. Before the first decision there is nothing on screen to
 * preserve and nothing vetted to reveal, so the splash stands alone. After it —
 * a signed-in rider who has only visited public paths, say, navigating somewhere
 * that needs the stamps — the shell is already mounted and correct, so covering
 * it with an opaque overlay keeps it mounted rather than tearing it down and
 * rebuilding it. `children` does mount underneath in that window; it is covered
 * completely, and RLS answers nothing to a rider who turns out not to belong
 * there, which is the same guarantee the guard leans on everywhere else.
 *
 * **There is deliberately no delay before the splash paints.** PD-111 §4
 * suggests ~150ms, on the sound reasoning that a splash on screen for 80ms reads
 * as a flicker rather than as progress. It cannot be had here: the only thing
 * visible during that delay would be `children`, and the whole reason this
 * component is waiting is that it does not yet know whether the rider is allowed
 * to see them. A flicker is the cheaper failure. With the cache in place the
 * window it would have softened has essentially stopped occurring anyway.
 *
 * ## The SSR pass
 *
 * Everything under `(app)` is still server-rendered by Next until the shell
 * lands, and in that pass there is no session to read. So the first client
 * render always starts undecided and resolves in an effect — which is the same
 * rule `lib/data/` obeys, for the same reason.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const snapshot = useSyncExternalStore(
    subscribeGuardCache,
    getGuardSnapshot,
    getServerGuardSnapshot
  )

  const state = guardStateFrom(snapshot, pathname)
  const booted = hasGuardBooted(snapshot)

  // `undefined` while undecided, so it is distinguishable from `null`, which is
  // the decision "stay here". Conflating them would render the splash forever on
  // every allowed route.
  const destination = state === undefined ? undefined : resolveDestination(pathname, state)

  useEffect(() => {
    attachGuardAuthListener()
    ensureGuardState(pathname)
    // `snapshot` so that a cache change which left this path still undecided —
    // the session landing on a path that also needs the stamps — issues the next
    // read instead of waiting for a navigation. `ensureGuardState` is a no-op
    // once the cache can answer, so re-running it costs nothing.
  }, [pathname, snapshot])

  useEffect(() => {
    if (!destination) return
    router.replace(destination)
  }, [destination, router])

  // Leaving. Never the children — that is the flash this component exists to
  // prevent — and never the overlay either, because the screen underneath is the
  // one the rider is being sent away from.
  if (destination) return <GuardSplash />

  if (destination === undefined) {
    return booted ? (
      <>
        {children}
        <GuardSplash overlay />
      </>
    ) : (
      <GuardSplash />
    )
  }

  return <>{children}</>
}

/**
 * `v2 / Component / Splash` — flat `Accent Brand/100`, not the app gradient.
 *
 * `role="status"` with a label rather than a visible spinner: on a warm cache
 * this is on screen for a frame or two, and an animation that brief reads as a
 * flicker rather than as progress.
 *
 * `overlay` raises it above every other fixed layer in the app — `Banner` at
 * `z-[80]` is the highest, and a banner showing through a guard that is still
 * deciding would be the previous screen's. It is opaque either way; the z-index
 * is the only difference, because the non-overlay case has nothing to cover.
 */
function GuardSplash({ overlay = false }: { overlay?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`bg-accent fixed inset-0 flex items-center justify-center ${overlay ? 'z-[100]' : ''}`}
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
