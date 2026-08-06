'use client'

import { useState, useTransition } from 'react'
import { joinClub, leaveClub } from '@/lib/actions/clubs'
import { Button } from '@/components/ui/Button'

/**
 * The join / leave control on the club detail page.
 *
 * Separate from `JoinClubButton` because the two are different controls in the
 * design, not one component with a size prop: this is a full-width
 * `Button / Regular`, while the Explore row's is a `Button / Link / Primary`
 * that only ever joins — an Explore row cannot show Leave, since a club you are
 * in is not on Explore.
 *
 * Both go through `lib/actions/clubs.ts`, which invalidates the `clubs` cache
 * prefix — so the About page, the roster and both club lists redraw from one
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
 * It renders on the About sub-page rather than in a header menu, because the
 * design puts club actions behind an `Options` control whose contents it never
 * draws — see `ClubDetailHeader`.
 */
export function ClubMembershipButton({ clubId, isMember }: { clubId: string; isMember: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mb-4">
      <Button
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await (isMember ? leaveClub(clubId) : joinClub(clubId))
            if (result.error) setError(result.error)
          })
        }}
        loading={pending}
        variant={isMember ? 'secondary' : 'primary'}
        size="lg"
        className="w-full"
      >
        {isMember ? 'Leave Club' : 'Join Club'}
      </Button>

      <p role="status" aria-live="polite" className="mt-2 text-sm text-danger empty:hidden">
        {error}
      </p>
    </div>
  )
}
