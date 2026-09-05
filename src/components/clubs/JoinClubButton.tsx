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
 * ## `onIntroduce` — the callback means OPEN THE SHEET, not "a join happened"
 *
 * **It was `onJoined` until PD-392 and the rename is the point.** This control
 * no longer writes the membership for a club where an introduction is owed: it
 * asks its parent to open the sheet in pre-join mode and writes nothing at all.
 * `Post` is what joins. Leaving the old name on the new meaning would have been
 * a lie at every call site.
 *
 * PD-384's reason for the callback survives the change and gets sharper. The
 * sheet cannot be rendered here, because `joinClub`'s invalidate moves this row
 * off Explore and unmounts this component — and under PD-392 that now happens
 * **while the rider's typed introduction is still in flight**, since the join
 * lands first and the introduction second. A sheet owned by the row would take
 * the draft with it. The parent screen outlives the row and owns it instead.
 *
 * ## The freshness read stays, and it moved in front of the sheet
 *
 * `hasIntroducedClub` used to run *after* the join, to decide whether to
 * prompt. It now runs on tap, before anything is written, because it is the
 * only guard against a **stale row**: both lists carrying a Join control are
 * cached queries, so a rider who joined in another tab — or was admitted by an
 * approved request or an invite link — still sees `Join club` here. Without the
 * read, that tap would open a sheet saying *"Post an introduction and you'll
 * join the club"* to somebody already in it, and `Post` would then report a
 * join that created nothing: `joinClub` upserts with `ignoreDuplicates`, so a
 * duplicate is a clean success. `design.md` §D4 has the trace.
 *
 * **The path is still cheaper than it was** — one read before the sheet,
 * against `joinClub` *and* `hasIntroducedClub` after it.
 *
 * **What the read cannot tell us is membership**, only whether an introduction
 * exists. A rider who is already a member and has *not* introduced themselves
 * is a stale row this guard still lets through, and they see the pre-join copy
 * over a membership they already hold.
 *
 * **That is one imprecise sentence AND one hole in the dismissal iff**, and the
 * second is the part worth writing down. If that rider taps `Join later`, the
 * sheet reports `membershipExists: false` — because its latch only knows about
 * a join *it* performed — so no session dismissal is recorded although a
 * membership exists. **It fails in the safe direction**: they are re-prompted
 * by the club detail's own state-driven sheet rather than silenced, which is
 * the opposite of the failure PD-392 is about. Closing it properly costs a
 * second round trip on every tap to fix a state that costs one extra prompt, so
 * it is left open deliberately and recorded here rather than left for the next
 * reader to find an iff hole and re-derive that it is benign.
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
  onIntroduce,
}: {
  clubId: string
  clubName: string
  /** `clubs.is_default` for this row — see the header; never hardcoded. */
  isDefaultClub: boolean
  /**
   * Open the pre-join sheet for this club. Nothing has been written when it
   * fires — see the header.
   *
   * **Required, because it carries the entire write.** Without an opener this
   * handler returns before `joinClub`, so the control writes nothing, opens
   * nothing and reports no error — a `Join club` button that does nothing at
   * all. `mode`, `isDefaultClub` and `ClubMembershipButton`'s own opener are
   * required for the same reason.
   */
  onIntroduce: (clubId: string) => void
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
            // BEFORE any write — the freshness guard, see the header.
            const alreadyIntroduced = await hasIntroducedClub(clubId)

            // `viewerRole: 'member'` is what this rider WOULD be once joined,
            // which is what makes this the same predicate the club detail
            // evaluates for a member. A Join control renders for a non-member
            // alone, so 'owner' is unreachable here.
            if (owesIntroduction({ viewerRole: 'member', isDefaultClub }, alreadyIntroduced)) {
              // Write nothing. `Post` joins; `Join later` does not.
              onIntroduce(clubId)
              return
            }

            // No introduction is owed — the default club, or a stale row for a
            // rider who already introduced themselves. Join outright, exactly
            // as before PD-392, and open no sheet. Joining the welcome club has
            // to stay a one-tap action: it is exempt from introductions, so a
            // sheet-only membership would make it unjoinable.
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
