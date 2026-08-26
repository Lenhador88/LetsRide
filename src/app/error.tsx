'use client'

import { useEffect } from 'react'
import { BoundaryError } from '@/components/ui/BoundaryError'

/**
 * The root error boundary — everything under the root layout that
 * `(app)/error.tsx` does not already own.
 *
 * That one covers the authenticated tree. Outside it sit `/auth/*`,
 * `/onboarding/*` and `/legal/*`, which had no boundary at all: a throw there
 * fell to Next's built-in error page — no retry, none of this app's design, and
 * on `/auth/login` and the onboarding wizard that is *every* new rider's only
 * road into the product. Same shape PD-122 gave the route guard, for the same
 * reason.
 *
 * A boundary catches only what is thrown *below* it, so this cannot catch the
 * root layout itself; `global-error.tsx` is that case and has to rebuild the
 * document to do it.
 *
 * The screen itself is `BoundaryError`, shared with `(app)/error.tsx` — the two
 * files' JSX was identical, and what legitimately differs between them is where
 * they are mounted and what they log.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled error outside the app tree:', error)
  }, [error])

  return <BoundaryError onRetry={reset} digest={error.digest} />
}
