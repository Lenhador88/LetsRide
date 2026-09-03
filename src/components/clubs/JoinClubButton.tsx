'use client'

import { useState, useTransition } from 'react'
import { joinClub } from '@/lib/actions/clubs'
import { hasIntroducedClub, owesIntroduction } from '@/lib/data/club-introductions'

/**
 * `v2 / Component / Button / Link / Primary` — the `Join club` control in the
 * trailing slot of every `Clubs - Explore` row. Accent Brand/100 at
 * Poppins/14/Semibold, no fill.
 *
 * The v1 version called `supabase.from()` in the browser and then
 * `router.refresh()`; CLAUDE.md marks that pattern for migration on contact,
 * and the clubs epic is the contact. The write is the same round trip it always
 * was — what changed is that it goes through `lib/actions/clubs.ts`, which
 * invalidates the `clubs` cache prefix, and that is what makes the row leave
 * Explore and appear on Your clubs in one pass rather than two.
 *
 * The distinction that matters has never been *where* the write runs — it runs
 * in the browser again now — but that it runs behind one named function that
 * owns the mutation and states what it makes stale.
 *
 * `preventDefault` is not incidental. The card's navigation is a stretched link
 * *under* this control, so without it a tap would join the club and open it —
 * and the join would be invisible because the page changed.
 *
 * ## `onJoined` — why the introduction sheet is not rendered here (PD-384)
 *
 * `joinClub`'s own invalidate is what moves this row off Explore, and that
 * refetch can complete before a second round trip (`hasIntroducedClub`) does —
 * so this component may already be unmounted by the time it would decide to
 * show a sheet. The caller owns a durable place to put it instead: `onJoined`
 * fires only once this rider is confirmed to still owe an introduction for
 * `clubId`, and the parent screen (which outlives this row) is what opens
 * `IntroductionPrompt`. A fresh join from Explore is never the owner and — the
 * default club auto-joins at signup, so it can never appear here with a `Join
 * club` control at all — never the default club either, which is why both are
 * asserted rather than read a second time.
 */
export function JoinClubButton({
  clubId,
  clubName,
  onJoined,
}: {
  clubId: string
  clubName: string
  onJoined?: (clubId: string) => void
}) {
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
            if (result.error) {
              setError(result.error)
              return
            }
            const alreadyIntroduced = await hasIntroducedClub(clubId)
            if (
              owesIntroduction({ viewerRole: 'member', isDefaultClub: false }, alreadyIntroduced)
            ) {
              onJoined?.(clubId)
            }
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
