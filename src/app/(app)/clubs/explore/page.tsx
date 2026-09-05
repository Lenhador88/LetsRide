'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { ExploreClubsList } from '@/components/clubs/ExploreClubsList'
import { IntroductionPrompt } from '@/components/clubs/IntroductionPrompt'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { dismissIntroductionPrompt } from '@/lib/clubs/introduction-dismissal'
import { getExploreClubs } from '@/lib/data/clubs'
import { getMyLocationText } from '@/lib/data/profile'
import { nearLabel } from '@/lib/location/near-label'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * `Clubs - Explore` — public clubs this rider has not joined.
 *
 * A real route rather than `/clubs?tab=explore`, following the ride detail's
 * sub-pages. A query parameter would have to be parsed and validated before it
 * reached a query, which is the defect `?club=` shipped on the rides list; a
 * segment cannot be malformed. That reasoning survives the render migration
 * intact — it is also why this is the one Clubs screen with no
 * `useSearchParams()` and so no `<Suspense>` boundary to arrange around.
 *
 * **The title and the back button are both new, and both are consequences of
 * PD-258 deleting `ClubPageMenu`.** The dropdown was this screen's only way
 * back, and it was also the only thing distinguishing it from `/clubs` — both
 * headers read `Clubs` and the sub-row said which one you were on. With it gone
 * the screen names itself and `backHref` returns to the tab root.
 *
 * Every row here is `is Joined=False`, so the trailing slot is `Join club` and
 * never the unread counter — 015 will not accept a watermark for a club the
 * rider has not joined, so the two agree by construction rather than by
 * convention.
 *
 * `joinClub` invalidates the whole `clubs` prefix, which is what makes a joined
 * row leave this list and appear on Your clubs — and, since PD-258, what moves
 * the strip's count on the tab root, because that count is `getExploreClubs`
 * read under this same key.
 *
 * **Since PD-259 the strip counts the NEAR clubs, and this screen sections them
 * under the same heading** — so the number the rider taps is the number they
 * land on. `ExploreClubsList` owns that split; a version where the strip
 * counted three and this screen listed twelve was caught in review.
 *
 * **This screen owns the introduction sheet for a join that happens here**
 * (`PD-384`) — `JoinClubButton` cannot hold it itself, because the same
 * invalidate that makes a joined row leave this list can unmount the row
 * before a second round trip (`hasIntroducedClub`) decides whether one is
 * owed. `introducingClubIds` gains a club once that decision comes back
 * `onJoined`, and this screen renders `IntroductionPrompt` once, off that
 * state, rather than the club detail page's own `showIntroductionPrompt`
 * (`097`, PD-365) — a rider who lands on the club afterwards still gets it
 * there too, since that rule reads `hasIntroducedClub` fresh rather than
 * trusting this screen remembered.
 *
 * **It is a QUEUE rather than one id, and the `key` is load-bearing.** Explore
 * is a browse action — PD-384 says in as many words that *"a rider may join
 * three clubs in a row"* — and each row owns its own `useTransition`, so
 * `pending` disables only the row that was tapped. Every other `Join club`
 * stays live across two round trips to `eu-west-1` (`joinClub`, then
 * `hasIntroducedClub`). With a single `string | null` that window cost either
 * correctness or the feature, depending only on which read landed first:
 *
 * - **A misdirected introduction.** Join A, join B, A's sheet opens, the rider
 *   starts typing, B resolves and overwrites the id. Nothing remounts, so the
 *   typed body survives while `clubId` flips underneath it and `submit()`
 *   posts the rider's words about A into B.
 * - **A dropped prompt.** The same two taps resolving the other way round: B
 *   overwrites A before A is ever shown, and A is neither prompted nor
 *   dismissed — PD-384's original defect, *"riders arrive silently and the club
 *   never meets them"*, in a narrower window.
 *
 * Appending instead of assigning fixes the second (nothing is overwritten) and
 * `key={current}` fixes the first (a different club is a different component
 * instance, so no draft can outlive the club it was written for). Dismissing or
 * posting advances the queue, so three joins ask three times, in tap order.
 */
export default function ExploreClubsPage() {
  const [introducingClubIds, setIntroducingClubIds] = useState<string[]>([])
  const introducingClubId = introducingClubIds[0] ?? null

  // Append-only, and de-duplicated: `joinClub` is an upsert, so a double tap on
  // one row must not queue that club twice.
  const enqueueIntroduction = (clubId: string) =>
    setIntroducingClubIds((queue) => (queue.includes(clubId) ? queue : [...queue, clubId]))

  /**
   * Records the dismissal for the club that was actually on screen — **if and
   * only if a membership exists** — then hands the sheet to the next club
   * waiting behind it.
   *
   * **`recordDismissal` is the whole of PD-392 on this screen, and dropping it
   * is the single easiest line in the change to get wrong.** This call was
   * unconditional, which was correct when the sheet only ever opened *after* a
   * join. It no longer does: a rider who taps `Join later` never joined, so
   * recording a dismissal for that club would silence the members-only prompt
   * if they are admitted by another door later in the same session — an
   * introduction suppressed on a fact the rider never asserted. Their answer
   * was *"I am not joining"*, not *"I am a member and I am not introducing
   * myself"*, and only the second is what this store means.
   *
   * The sheet is what knows, because it is the thing whose write returned — see
   * `IntroductionPrompt`'s header — so the answer arrives as `onDismiss`'s
   * argument rather than being re-read from a cache this would have to race.
   *
   * The write stays OUTSIDE the updater and reads `introducingClubId` from this
   * render, which is the same `queue[0]` the sheet was showing. Inside, it would
   * be a side effect in a function React requires to be pure:
   * `dismissIntroductionPrompt` ends in `notify()`, which synchronously calls
   * every `useSyncExternalStore` listener, and StrictMode invokes updaters twice
   * on purpose to surface exactly this.
   */
  const advanceIntroductions = (recordDismissal: boolean) => {
    if (recordDismissal && introducingClubId) dismissIntroductionPrompt(introducingClubId)
    setIntroducingClubIds((queue) => queue.slice(1))
  }
  // The same three reads as `/clubs`, under the same keys — which is what makes
  // arriving here from the strip a cache hit rather than a second fetch, and
  // what keeps the strip's near count equal to the `Near <name>` section below
  // (PD-258's second trap).
  const near = useQuery(queryKeys.riderLocation(), resolveRiderLocation)
  const city = useQuery(queryKeys.profile.location(), getMyLocationText)

  // Held until the position is decided — see `/clubs` for the double fetch this
  // avoids. `undefined` is "not yet"; `null` is "no position", which is a real
  // answer and gets the unfiltered list.
  // `|| !!near.error` for the reason `/rides` spells out at its own gate: a
  // rejected read leaves `data` undefined for ever, and gating on that alone
  // parks this list in the skeleton branch with no retry. `resolveRiderLocation`
  // catches its own chain, so nothing can reach it today — which is why it is
  // worth one line rather than resting on a never-rejects guarantee that lives
  // in another module and is asserted nowhere.
  const positionDecided = near.data !== undefined || !!near.error
  const position = near.data ?? null
  const clubs = useQuery(
    positionDecided ? queryKeys.clubs.explore(position) : null,
    () => getExploreClubs(position)
  )

  return (
    <>
      <Header title="Explore clubs" backHref="/clubs" />

      {/* `.pb-navbar-action-extra` because the Navbar carries a sticky
          `Create club` on this route too — without it the last card sits under
          the button. Missing on both club screens until PD-258.

          The two placeholder treatments sit outside the `px-4`, not inside it:
          both are built at the list's own padding, so nesting would draw them
          16px narrower than the cards they stand in for. */}
      <div className="pb-navbar-action-extra">
        {clubs.error ? (
          <ErrorState onRetry={clubs.refetch} />
        ) : !clubs.data ? (
          <SkeletonList />
        ) : (
          <div className="px-4 pt-4 motion-safe:animate-fade-in">
            {clubs.data.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-muted">
                There are no public clubs, yet!
              </p>
            ) : (
              <ExploreClubsList
                clubs={clubs.data}
                near={nearLabel(position, city.data)}
                onIntroduce={enqueueIntroduction}
              />
            )}
          </div>
        )}
      </div>

      {/* Always `pre-join` here: since PD-392 this screen's Join control writes
          nothing and opens the sheet instead, so every sheet Explore mounts
          starts before a membership exists. The sheet latches itself to member
          mode when its own join lands — that is not this screen's to track, and
          a page-level latch would leak one club's answer into the next one in
          the queue (`design.md` §D3).

          `onPosted` records unconditionally and that IS the iff rather than an
          exception to it: a successful Post means a membership exists. It is
          also what closes the sheet without waiting on the invalidated read. */}
      <IntroductionPrompt
        key={introducingClubId}
        clubId={introducingClubId ?? ''}
        mode="pre-join"
        open={!!introducingClubId}
        onDismiss={(membershipExists) => advanceIntroductions(membershipExists)}
        onPosted={() => advanceIntroductions(true)}
      />
    </>
  )
}
