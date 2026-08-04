'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

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
      {/* The digest is Next's server-side correlation id. It is the one piece of
          detail worth showing: it is meaningless to an attacker and it is what
          makes a bug report findable in the logs. */}
      {error.digest && <p className="text-2xs text-muted">Reference: {error.digest}</p>}
    </div>
  )
}
