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
 * Both now go through Server Actions. The pattern this replaced took a second
 * round trip through `router.refresh()` to show its own result.
 *
 * It retires the last v1 write CLAUDE.md *names*, not the last one that exists:
 * `/clubs/new` and `/rides/new` are both `'use client'` pages still calling
 * `supabase.from()` directly, and they migrate with their own screens. Count
 * them rather than trusting this line —
 * `grep -rn "supabase.from(" src/app/ src/components/`.
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
