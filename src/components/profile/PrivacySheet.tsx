'use client'

import { useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { BlockedRidersList } from '@/components/profile/BlockedRidersList'
import { HiddenPostcardsList } from '@/components/profile/HiddenPostcardsList'
import { setAnalyticsOptOut } from '@/lib/actions/profile'
import { getAnalyticsOptOut } from '@/lib/data/profile'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * The analytics opt-out — PD-353 — and, since PD-298, the two lists that make
 * a block and a hide undoable.
 *
 * ## Why the undo lists live here rather than on a route of their own
 *
 * Product owner, 2026-09-05, choosing proposal 3 with the surface named: both
 * lists, inside this sheet, reached by Profile → ⋯ → Privacy. It adds no nav
 * entry and no route. This sheet was already the "what others see of me"
 * surface, and "who I have made invisible to me" is the same question read from
 * the other side.
 *
 * Neither list could be built until `105`: `009` applies symmetric
 * `private.is_blocked` to `profiles`, and `011` §3 puts the hide conjunct
 * inside the `postcards` SELECT policy — so a rider can read their own `blocks`
 * and `postcard_hides` rows and *nothing about what they point at*. That, not
 * the missing Figma frame, is why `unblockRider` and `unhidePostcard` sat
 * uncalled from the day they were written.
 *
 * ## Why it is a sheet and not a row in the menu
 *
 * A `ContextMenuItem` is an action: tap it and something happens. This is a
 * *state*, and a rider has to be able to see which way it is set without
 * changing it — which a menu row cannot show. The sheet is also the only place
 * with room for the two paragraphs below, and those are not decoration: an
 * unqualified "stop recording me" toggle would make a promise this app cannot
 * keep, which is the failure this whole screen exists to avoid.
 *
 * `FeedbackSheet` and `DeleteAccountSheet` are the same shape, opened the same
 * way from `ProfileMenu`.
 *
 * ## The copy says less than it used to, and the trim had one hard edge
 *
 * Product owner, 2026-09-05 (PD-405): make these options **more subtle** —
 * *"All that detailed info can be viewed in the privacy policy, so Record how I
 * use the app, and the label below, should say something more professional."*
 * The checkbox is three words now and its sub-label is gone entirely.
 *
 * **What could not be trimmed away is the replay disclosure, only MOVED.** It
 * is the only place a rider is told their screen is recorded *before* they
 * consent, so it is now a clause in the intro paragraph above the toggle rather
 * than a caption under it. A sheet reading only `Share usage data` over a switch
 * that turns on session replay is the shape a regulator or a store reviewer
 * reads as consent that was not informed — and it is the shape this file is one
 * careless trim away from at any time, which is why
 * `__tests__/PrivacySheet.test.tsx` pins the fact and its ORDER rather than
 * trusting a comment.
 *
 * Three surfaces have to keep agreeing about this and only one of them is
 * enforceable from here: this sheet, `/legal/privacy` (the exhaustive version —
 * what the replay shows, and the two things withheld from it), and the App
 * Store *Data Collection* / Play *Data safety* forms, which are still
 * unanswered and parked on PD-232. Write copy here from
 * `src/lib/observability/scrub.ts` and `src/lib/analytics/events.ts`, which are
 * what actually ships, never from a description of them.
 *
 * ## The copy is doing load-bearing work, in two places
 *
 * **It must not claim the opt-out removes what was already collected.** It
 * stops future collection. Erasing what PostHog already holds is not wired —
 * `delete-account` does not reach PostHog at all, so a rider who erases their
 * account still leaves their events and their recordings behind — and that is
 * an open item on PD-353 rather than something this sheet may imply is done.
 * `/legal/privacy` says the same thing in the same words, and both name the
 * route that does work: writing to us.
 *
 * **It must not imply a rider can opt out of appearing in someone else's
 * recording.** This is the limit PD-353's own retirement condition is built
 * around: an unmasked recording captures everyone whose postcard, caption,
 * byline, photo and club is on the recorded rider's screen, and none of those
 * people opted into anything or can reach this toggle. No schema change could
 * fix that, so the copy says "your own activity" rather than "you", and the
 * real answer is the pilot ending — see `lib/analytics/client.ts` for the
 * condition that ends it.
 *
 * ## The checkbox is phrased as the ON state, not the opt-out
 *
 * Checked means "yes, collect it". A checkbox labelled with a negative
 * ("Don't record me") is checked when the thing is *off*, which is the classic
 * consent dark pattern read backwards — riders misread it in both directions.
 * The stored column is `analytics_opt_out_at`, so this component inverts once,
 * here, where it is visible.
 */
export function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ContextMenu open={open} onClose={onClose} label="Privacy">
      <PrivacyControls onClose={onClose} />
    </ContextMenu>
  )
}

function PrivacyControls({ onClose }: { onClose: () => void }) {
  const online = useOnlineStatus()
  const optOut = useQuery(queryKeys.profile.analyticsOptOut(), getAnalyticsOptOut)

  // Local, so the box moves under the rider's finger rather than after a round
  // trip. `pending` disables it, so the two cannot disagree for longer than one
  // in-flight write, and a failure puts it back.
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [override, setOverride] = useState<boolean | null>(null)

  if (optOut.error) return <ErrorState onRetry={optOut.refetch} />

  // Gated on the data, never on `isLoading` — on the first render pass there is
  // no data AND no fetch in flight, so a screen gating on `isLoading` draws
  // `undefined` where its state should be.
  if (optOut.data === undefined) {
    return (
      <div className="flex flex-col gap-6 pb-2">
        <h2 className="text-2xl font-semibold text-foreground">Privacy</h2>
        <div className="h-5 w-40 animate-pulse rounded bg-track" />
      </div>
    )
  }

  const optedIn = override ?? !optOut.data

  async function toggle(nextOptedIn: boolean) {
    setOverride(nextOptedIn)
    setError(null)
    setPending(true)
    const result = await setAnalyticsOptOut(!nextOptedIn)
    setPending(false)
    if (result.error) {
      setOverride(null)
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-2">
      {/* Bounded and scrolled HERE rather than in `ContextMenu`, which sets no
          max height at all. Two lists that grow with a rider's own history
          would otherwise push `Close` past the bottom of the screen — and on a
          bottom sheet that is unrecoverable, because there is no page behind it
          to scroll. Bounding the primitive instead would change the postcard
          overflow menu and every other caller, none of which has this problem.
          `Close` stays outside this box so it is always reachable. */}
      <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold text-foreground">Privacy</h2>
          {/* **The replay clause lives HERE, and moving it is not a copy
              decision** — see the class note above. One sentence: what is
              collected, that it includes a recording of the rider's own screen,
              and what it is for. `/legal/privacy` carries the exhaustive
              version (what the replay shows, the two things withheld from it);
              this is the summary a rider reads before deciding, which is the
              part that has to be here rather than behind a link. */}
          <p className="text-sm text-muted">
            We record how the app is used — the screens you open and a replay of your own
            screen — so we can find what is broken or confusing.
          </p>
        </div>

        <div className="flex flex-col gap-3">
        <Checkbox
          checked={optedIn}
          disabled={pending || !online}
          onChange={(event) => void toggle(event.target.checked)}
          // Three words, and no sub-label at all (PD-405). What was under it —
          // "a replay of your own screen. Never your password." — is the app
          // explaining its own mechanism at a rider who opened a sheet to flip
          // one switch. The half that is a DISCLOSURE moved up into the intro;
          // the half that was reassurance ("never your password") is gone,
          // because withholding a promise nobody asked for costs a rider
          // nothing and `/legal/privacy` states it in full.
          label="Share usage data"
        />

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
          {!online && (
            <p className="text-xs font-medium text-muted">You’re offline — reconnect to change this.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {/* Trimmed rather than cut (PD-405). Both claims here are claims
              about the rider's DATA rather than descriptions of a feature, so
              neither may go: that opting out does not erase what was already
              collected, and that it cannot reach another rider's replay. What
              went is the worked example after the dash — `/legal/privacy` gives
              it in full, one tap below. */}
          <p className="text-xs text-muted">
            Turning this off stops any further recording. It does not delete what has already
            been collected, and it cannot remove you from another rider’s replay. To have your
            records deleted, email us.
          </p>
          <p className="text-xs text-muted">
            <Link href="/legal/privacy" className="underline">
              Read the privacy statement
            </Link>
          </p>
        </div>

        {/* PD-298. Each list owns its own loading and error state, so one
            failing read leaves the other list and the toggle above working —
            a settings screen that blanks wholesale because one of three reads
            failed is worse than one that says which part is unavailable. */}
        <div className="border-t border-border pt-6">
          <BlockedRidersList />
        </div>

        <div className="border-t border-border pt-6">
          <HiddenPostcardsList />
        </div>
      </div>

      <Button type="button" variant="secondary" size="md" onClick={onClose}>
        Close
      </Button>
    </div>
  )
}
