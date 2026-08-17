'use client'

import { ErrorState } from '@/components/ui/ErrorState'

/**
 * What the route guard draws when its own read threw (PD-122).
 *
 * The splash has no tap target on it — deliberately, since it is on screen for
 * a frame or two in the ordinary case — so a read that rejected left the rider
 * on a full-screen green with no app behind it and only a reload to escape.
 * This is the same window with a way out of it.
 *
 * **A wrapper around `ErrorState`, not a second copy of it.** That primitive is
 * already message-plus-retry and already carries the app's voice for a failed
 * read; what it is not is full-screen — it is a padded in-flow block sized to
 * sit where one `useQuery` result would have gone. All this adds is the
 * `fixed inset-0` the guard needs to *replace* the splash, which is a guard
 * concern rather than a change to a shared primitive.
 *
 * `overlay` mirrors `GuardSplash`'s prop exactly, for the same reason: after
 * boot the shell underneath is already mounted and correct, so covering it
 * beats tearing it down. Opaque either way — the z-index is the only difference.
 *
 * Says nothing about *why*, matching `app/(app)/error.tsx` and `ErrorState`
 * itself. The one trace of the cause is the `console.error` in
 * `guard-cache.ts`'s catch.
 */
export function GuardError({ overlay = false, onRetry }: { overlay?: boolean; onRetry: () => void }) {
  return (
    <div
      className={`bg-background fixed inset-0 flex items-center justify-center px-6 ${overlay ? 'z-[100]' : ''}`}
    >
      <ErrorState
        message="We could not start the app. It is usually temporary — try again in a moment."
        onRetry={onRetry}
      />
    </div>
  )
}
