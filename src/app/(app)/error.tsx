'use client'

import { useEffect } from 'react'
import { BoundaryError } from '@/components/ui/BoundaryError'
import { reportError } from '@/lib/observability/sentry'

/**
 * Catches a failed read anywhere in the authenticated tree.
 *
 * This exists because `lib/data/` now throws instead of returning an empty
 * result. Without a boundary, a failed feed query would render Next's default
 * error page; with one, it says the true thing — we could not load this, try
 * again — instead of the old lie, which was an empty feed indistinguishable
 * from a rider who genuinely has no postcards.
 *
 * Deliberately says nothing about *why*. The message on a `DataReadError`
 * carries a PostgREST code and the failing relation, which belongs in the
 * server log and not on a rider's screen.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Next already logs this server-side; this is what makes it visible when
    // the throw happens during client navigation instead of the initial render.
    console.error('Unhandled error in the app tree:', error)
    // PD-315 — the console line reaches the rider's own devtools and nobody
    // else's, which for a client-rendered bundle is most rider-visible
    // breakage going unrecorded.
    reportError(error, { boundary: 'app', digest: error.digest })
  }, [error])

  return <BoundaryError onRetry={reset} digest={error.digest} />
}
