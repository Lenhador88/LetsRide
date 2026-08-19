'use client'

import { useState, useTransition } from 'react'
import { joinClub } from '@/lib/actions/clubs'
import { Button } from '@/components/ui/Button'

/**
 * The join control on the club detail page.
 *
 * Separate from `JoinClubButton` because the two are different controls in the
 * design, not one component with a size prop: this is a full-width
 * `Button / Regular`, while the Explore row's is a `Button / Link / Primary`.
 *
 * **It only joins.** Leaving moved into `ClubOptionsMenu` when the club detail
 * merged into one screen, so this renders for a non-member and nobody else —
 * which is also why it takes no `isMember`: a boolean prop whose only call site
 * pins it to one value is the shape that gets reused wrongly later.
 *
 * Both go through `lib/actions/clubs.ts`, which invalidates the `clubs` cache
 * prefix — so the club detail, the roster and both club lists redraw from one
 * call. The v1 pattern this replaced wrote from the component and then took a
 * second round trip through `router.refresh()` to show its own result.
 *
 * That pattern is gone from the repo rather than merely from this component.
 * Count it rather than trusting the line — but **not** with the bare
 * `grep -rn "supabase.from("` CLAUDE.md quotes, which now matches three
 * sentences of prose describing the migration, this one included. The importer
 * form is the one that means something:
 * `grep -rn "from '@/lib/supabase/" src/app/ src/components/`, and its three
 * hits are all auth surfaces that need a session rather than a row.
 *
 * It renders inline on the club detail rather than in the header's dots menu:
 * a constructive action stays visible, and only the destructive one is tucked
 * away — see `ClubOptionsMenu`.
 */
export function ClubMembershipButton({ clubId }: { clubId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mb-4">
      <Button
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await joinClub(clubId)
            if (result.error) setError(result.error)
          })
        }}
        loading={pending}
        variant="primary"
        size="lg"
        className="w-full"
      >
        Join Club
      </Button>

      <p role="status" aria-live="polite" className="mt-2 text-sm text-danger empty:hidden">
        {error}
      </p>
    </div>
  )
}
