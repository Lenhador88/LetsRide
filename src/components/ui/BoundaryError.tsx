'use client'

import { Button } from '@/components/ui/Button'

/**
 * The screen both React error boundaries draw — `src/app/error.tsx` and
 * `src/app/(app)/error.tsx`.
 *
 * One component because the two files' JSX was byte-identical the day the
 * second one was written, and two copies of one screen drift: the next change
 * to the copy, the spacing or the digest line lands in whichever file its author
 * happened to open. What legitimately differs between the boundaries is *where
 * they are mounted* and *what they log*, and both of those stay in the files.
 *
 * **Not `ErrorState`**, which is the other error surface here and is a
 * different thing: that one is for a `useQuery` that failed inside a screen
 * that otherwise rendered, so it sits inline and retries the read. This
 * replaces a whole subtree that threw, and its retry is React's `reset`.
 *
 * Deliberately says nothing about *why*, matching `ErrorState` and
 * `GuardError`. A `DataReadError`'s message carries a PostgREST code and the
 * failing relation, which belongs in a log and not on a rider's screen.
 */
export function BoundaryError({
  onRetry,
  digest,
}: {
  onRetry: () => void
  /** Next's server-side correlation id. The one detail worth showing: it is
   * meaningless to an attacker and it is what makes a bug report findable. */
  digest?: string
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Something went wrong</h1>
      <p className="text-sm text-muted">
        We could not load this screen. It is usually temporary — try again in a moment.
      </p>
      <Button onClick={onRetry} size="md" className="mt-2 w-auto">
        Try again
      </Button>
      {digest && <p className="text-2xs text-muted">Reference: {digest}</p>}
    </div>
  )
}
