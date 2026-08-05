'use client'

import { Button } from '@/components/ui/Button'

/**
 * The scoped counterpart to `app/(app)/error.tsx` (task 5.3). That boundary
 * catches a throw anywhere in the tree and can only re-render the whole
 * route; this renders in place of one `useQuery` result and retries only
 * that read via its `refetch`, because a like button failing to load its
 * count should not blank the postcard beneath it.
 *
 * Copy matches the route boundary's own wording and the voice
 * `lib/actions/*.ts` already uses for a failed write throughout — plain,
 * no blame, no exclamation mark, and deliberately silent about *why*, the
 * same reasoning `app/(app)/error.tsx` gives for not showing the failing
 * relation on screen.
 */
export function ErrorState({
  message = 'We could not load this. It is usually temporary — try again in a moment.',
  onRetry,
}: {
  message?: string
  onRetry: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-sm text-muted">{message}</p>
      <Button onClick={onRetry} size="md" className="w-auto">
        Try again
      </Button>
    </div>
  )
}
