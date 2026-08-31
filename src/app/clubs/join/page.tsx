'use client'

import { useEffect } from 'react'
import { ClubInviteJoin } from '@/components/clubs/ClubInviteJoin'
import { AppBackground } from '@/components/ui/AppBackground'
import { adoptInviteTokenFromLocation } from '@/lib/invites/pending-token'
import { usePendingInviteToken } from '@/lib/invites/use-pending-token'

/**
 * The club invite link's landing route — `093`, PD-360, `/rides/join`'s exact
 * shape one domain over.
 *
 * **It sits at the top level rather than under `(app)`**, alongside
 * `/rides/join`, `/auth/*` and `/legal/*`, because it is public: the `(app)`
 * layout is the authenticated shell, and drawing the four tabs for a visitor
 * with no session would offer four taps that all bounce to the login screen.
 * `RouteGuard` is in the ROOT layout, so this route is still guarded — it is
 * simply guarded to "stay", and a signed-in rider mid-wizard is still sent to
 * their resume step from here, because `/clubs/join` is in
 * `needsOnboardingState()`'s set as well as in `PUBLIC_PATHS`.
 *
 * ## The token is resolved in an effect, and there are three reasons
 *
 * 1. **`sessionStorage` does not exist during the prerender pass.** Next
 *    server-renders client components on first load, so reading the stash in
 *    the component body is a crash on the server and a hydration mismatch in
 *    the browser. Same rule `lib/data/` obeys, one API down.
 * 2. **`history.replaceState` is a side effect**, and the token is dropped
 *    from the visible URL once it has been read — see
 *    `adoptInviteTokenFromLocation` for what that buys and, more importantly,
 *    what it does not.
 * 3. It means `useSearchParams()` is never read during render — unlike
 *    `/rides/join`, this route needs no `<Suspense>` boundary for that reason,
 *    because it never calls `useSearchParams()` at all: the token comes from
 *    `usePendingInviteToken('club')`, which reads the module-level snapshot
 *    `adoptInviteTokenFromLocation` publishes into rather than the URL
 *    directly.
 *
 * ## The URL is the durable copy and the stash is the convenience
 *
 * A token in the query string is stashed and then removed; a rider returning
 * from sign-in or from the onboarding wizard arrives with a clean URL and the
 * stash is what answers. Either way the original message still works, which
 * is why no recovery mechanism beyond re-opening the link exists or should.
 */
export default function JoinClubPage() {
  const token = usePendingInviteToken('club')

  useEffect(() => {
    adoptInviteTokenFromLocation('club')
  }, [])

  return (
    <AppBackground className="flex min-h-dvh justify-center">
      {/* `.pt-header`, not a bare offset like `/rides/join`'s: unlike
          `RideInviteJoin`, the signed-in success state here mounts
          `ClubPreviewScreen`, which renders its own FIXED `Header`
          (`ClubDetailHeader`) — the same reservation `(app)/layout.tsx`
          normally supplies. The other states carry no header and pad
          themselves, matching every screen in this app that scrolls under a
          header some states of it do not draw. */}
      <div className="pt-header flex w-full max-w-[390px] flex-col pb-8">
        <ClubInviteJoin token={token} />
      </div>
    </AppBackground>
  )
}
