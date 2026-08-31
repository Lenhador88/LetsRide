'use client'

import { useEffect } from 'react'
import { RideInviteJoin } from '@/components/rides/RideInviteJoin'
import { AppBackground } from '@/components/ui/AppBackground'
import { adoptInviteTokenFromLocation } from '@/lib/invites/pending-token'
import { usePendingInviteToken } from '@/lib/invites/use-pending-token'

/**
 * The invite link's landing route — `091`, PD-330.
 *
 * **It sits at the top level rather than under `(app)`**, alongside `/auth/*`
 * and `/legal/*`, because it is public: the `(app)` layout is the authenticated
 * shell, and drawing the four tabs for a visitor with no session would offer
 * four taps that all bounce to the login screen. `RouteGuard` is in the ROOT
 * layout, so this route is still guarded — it is simply guarded to "stay", and
 * a signed-in rider mid-wizard is still sent to their resume step from here,
 * because `/rides/join` is in `needsOnboardingState()`'s set as well as in
 * `PUBLIC_PATHS`.
 *
 * ## The token is resolved in an effect, and there are three reasons
 *
 * 1. **`sessionStorage` does not exist during the prerender pass.** Next
 *    server-renders client components on first load, so reading the stash in the
 *    component body is a crash on the server and a hydration mismatch in the
 *    browser. Same rule `lib/data/` obeys, one API down.
 * 2. **`history.replaceState` is a side effect**, and the token is dropped from
 *    the visible URL once it has been read — see `adoptInviteTokenFromLocation`
 *    for what that buys and, more importantly, what it does not.
 * 3. It means `useSearchParams()` is never read during render, so this route
 *    needs no `<Suspense>` boundary to keep prerendering. `useBack` reads
 *    `window.location` in a handler for the same reason.
 *
 * **The effect publishes to a store rather than calling `setState`.** A
 * `setState` in a mount effect is a cascading render, and the app already has
 * the right shape for this twice over — `guard-cache.ts` and
 * `lib/query/connectivity.ts` both hold a module snapshot read through
 * `useSyncExternalStore`. It also means the token is resolved once per page
 * load rather than once per mount.
 *
 * ## The URL is the durable copy and the stash is the convenience
 *
 * A token in the query string is stashed and then removed; a rider returning
 * from sign-in or from the onboarding wizard arrives with a clean URL and the
 * stash is what answers. Either way the original message still works, which is
 * why no recovery mechanism beyond re-opening the link exists or should.
 */
export default function JoinRidePage() {
  const token = usePendingInviteToken('ride')

  useEffect(() => {
    adoptInviteTokenFromLocation('ride')
  }, [])

  return (
    <AppBackground className="flex min-h-dvh justify-center">
      <div className="flex w-full max-w-[390px] flex-col px-6 pb-8 pt-[96px]">
        <RideInviteJoin token={token} />
      </div>
    </AppBackground>
  )
}
