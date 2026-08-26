'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

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
 * Deliberately says nothing about *why*, matching `(app)/error.tsx`,
 * `ErrorState` and `GuardError`. The digest is the exception, and the reasoning
 * for showing it is in `(app)/error.tsx`.
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

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Something went wrong</h1>
      <p className="text-sm text-muted">
        We could not load this screen. It is usually temporary — try again in a moment.
      </p>
      <Button onClick={reset} size="md" className="mt-2 w-auto">
        Try again
      </Button>
      {error.digest && <p className="text-2xs text-muted">Reference: {error.digest}</p>}
    </div>
  )
}
