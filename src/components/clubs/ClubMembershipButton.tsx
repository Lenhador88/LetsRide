'use client'

import { useState, useTransition } from 'react'
import { joinClub } from '@/lib/actions/clubs'
import { hasIntroducedClub, owesIntroduction } from '@/lib/data/club-introductions'
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
 *
 * ## Since PD-392 it defers the membership, exactly as `JoinClubButton` does
 *
 * Where an introduction would be owed this control **writes nothing** and asks
 * the club detail screen to open the sheet in pre-join mode; `Post` is what
 * joins. The two controls stay two components — they are different controls in
 * the design, not one with a size prop — but they now answer the same question
 * the same way, and `JoinClubButton`'s header carries the full reasoning for
 * both.
 *
 * ## `isDefaultClub` is a NEW prop, and it is not optional
 *
 * This control did not take it before, and that was survivable only because it
 * never decided anything with it. Now it does: the welcome club is exempt from
 * introductions (`058`, `097`), so if the sheet were the only writer of a
 * membership that club would become **unjoinable** — and it is reachable, with
 * a live Join control, for every rider outside it (`JoinClubButton`'s header
 * measured 15 of 24 on DEV). Where no introduction is owed this joins outright,
 * exactly as it always did.
 *
 * **It is read from `clubs.is_default`, never assumed from this screen's
 * position in the flow.** That is PD-384's defect verbatim — a control that
 * reasoned *"the default club auto-joins at signup, so it cannot appear
 * here"* — and it is why this is a required prop rather than a default of
 * `false`, which would put the sheet in front of a rider joining the welcome
 * club.
 */
export function ClubMembershipButton({
  clubId,
  isDefaultClub,
  onIntroduce,
}: {
  clubId: string
  /** `clubs.is_default`, read by the caller off the club it already holds. */
  isDefaultClub: boolean
  /** Open the pre-join sheet. Nothing has been written when it fires. */
  onIntroduce?: (clubId: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mb-4">
      <Button
        onClick={() => {
          setError(null)
          startTransition(async () => {
            // Before any write, and for `JoinClubButton`'s reason: this screen
            // is a cached read too, so a rider admitted by another door since it
            // loaded can still be looking at `Join Club`.
            const alreadyIntroduced = await hasIntroducedClub(clubId)

            if (owesIntroduction({ viewerRole: 'member', isDefaultClub }, alreadyIntroduced)) {
              onIntroduce?.(clubId)
              return
            }

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
