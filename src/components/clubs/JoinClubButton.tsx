'use client'

import { useState, useTransition } from 'react'
import { joinClub } from '@/lib/actions/clubs'

/**
 * `v2 / Component / Button / Link / Primary` — the `Join club` control in the
 * trailing slot of every `Clubs - Explore` row. Accent Brand/100 at
 * Poppins/14/Semibold, no fill.
 *
 * The v1 version called `supabase.from()` in the browser and then
 * `router.refresh()`; CLAUDE.md marks that pattern for migration on contact,
 * and the clubs epic is the contact. Revalidation now happens server-side
 * inside the action, which is what makes the row leave Explore and appear on
 * Your clubs in one pass rather than two.
 *
 * This was the last such component CLAUDE.md named. It was not the last one in
 * the repo — the two v1 create pages still write from the client — so that
 * claim is corrected there rather than repeated here.
 *
 * `preventDefault` is not incidental. The card's navigation is a stretched link
 * *under* this control, so without it a tap would join the club and open it —
 * and the join would be invisible because the page changed.
 */
export function JoinClubButton({ clubId, clubName }: { clubId: string; clubName: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        aria-label={`Join ${clubName}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setError(null)
          startTransition(async () => {
            const result = await joinClub(clubId)
            if (result.error) setError(result.error)
          })
        }}
        className="rounded px-1 py-1.5 text-sm font-semibold text-accent transition-opacity disabled:opacity-50"
      >
        {pending ? 'Joining…' : 'Join club'}
      </button>

      {/* The live region has to exist before its content changes, or a screen
          reader announces nothing — the exact defect review caught on the
          profile form's `role={error ? 'status' : undefined}`. */}
      <p role="status" aria-live="polite" className="text-2xs text-danger empty:hidden">
        {error}
      </p>
    </div>
  )
}
