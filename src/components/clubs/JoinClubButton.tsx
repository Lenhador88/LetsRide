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
 * `IntroductionPrompt`.
 *
 * ## `isDefaultClub` is READ, never assumed
 *
 * A fresh join from Explore is never the owner, so `viewerRole: 'member'` is a
 * sound constant. **The default club is not**, and asserting it was a real
 * defect: this control claimed the welcome club *"can never appear here"*
 * because it auto-joins at signup, and `getExploreClubs`' public half filters
 * on `is_public` alone with no `is_default` exclusion. Two documented states
 * put it back on this list with a `Join club` button — a member who LEAVES it
 * (`club_members` DELETE is a bare `auth.uid() = user_id`, and `leaveClub` has
 * no default-club guard; only the owner is refused, `095`/`059`), and a signup
 * whose join silently selected zero rows, which `059` §2 documents as a
 * SUCCESS that no exception block can see. Measured on DEV: the welcome club
 * is `is_public = true` and 15 of 24 riders were not members of it.
 *
 * So the prompt would have asked those riders to introduce themselves to the
 * one club nobody chose — exactly what `058`'s own reasoning excludes, and what
 * the club detail page already gets right by reading `club.is_default`
 * (`097`, PD-365). The two doors now read the same column instead of
 * disagreeing about the same rider.
 */
export function JoinClubButton({
  clubId,
  clubName,
  isDefaultClub,
  onJoined,
}: {
  clubId: string
  clubName: string
  /** `clubs.is_default` for this row — see the header; never hardcoded. */
  isDefaultClub: boolean
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
              owesIntroduction({ viewerRole: 'member', isDefaultClub }, alreadyIntroduced)
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
