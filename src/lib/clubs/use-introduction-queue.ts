'use client'

import { useState } from 'react'
import { dismissIntroductionPrompt } from '@/lib/clubs/introduction-dismissal'

/**
 * The pre-join introduction sheet's queue, shared by the two screens that draw
 * a list of joinable clubs — `/clubs/explore` and `/clubs`' own first-run
 * screen (PD-392, PD-384).
 *
 * **It is a hook rather than two copies because there are two mount points and
 * one of them was missed.** `ExploreClubsList` is rendered from both screens,
 * and the pre-merge review caught the first-run one wired without an opener at
 * all: every `Join club` on the screen a rider sees *before they have joined
 * anything* did nothing — no membership, no sheet, no error. Two hand-written
 * copies of this logic are how that comes back, and `CLAUDE.md`'s
 * *individually correct and collectively inconsistent* is the shape.
 *
 * ## Why a QUEUE and not one id — PD-384's two named defects
 *
 * A rider may tap Join on several rows, and each row owns its own transition.
 * With a single `string | null` the window between two taps cost either
 * correctness or the feature, depending only on which read landed first:
 *
 * - **A misdirected introduction.** Tap A, tap B, A's sheet opens, the rider
 *   starts typing, B overwrites the id. Nothing remounts, so the typed body
 *   survives while the club flips underneath it and `Post` sends the rider's
 *   words about A into B. The caller's `key={current}` is the other half of
 *   this fix: a different club is a different component instance, so no draft
 *   can outlive the club it was written for.
 * - **A dropped prompt.** The same two taps resolving the other way: B
 *   overwrites A before A is ever shown, and A is neither prompted nor
 *   dismissed.
 *
 * Appending fixes the second; the caller's `key` fixes the first. **Under
 * PD-392 the arrival rate falls but the shape does not change** — the sheet is
 * `aria-modal` over a scrim, so a second row cannot be tapped while it is open,
 * and nothing is written until `Post`, so no row leaves the list mid-sheet.
 * That is a reason to keep the queue rather than to drop it: it costs nothing
 * and it is what the two defects above were closed with.
 */
export function useIntroductionQueue() {
  const [clubIds, setClubIds] = useState<string[]>([])
  const current = clubIds[0] ?? null

  /** Append-only and de-duplicated: a double tap on one row must not queue the
   *  same club twice. */
  const enqueue = (clubId: string) =>
    setClubIds((queue) => (queue.includes(clubId) ? queue : [...queue, clubId]))

  /**
   * Closes the sheet on screen and hands it to the next club behind it,
   * recording a session dismissal **if and only if a membership exists** —
   * PD-392's iff, `design.md` §D2.
   *
   * **`recordDismissal` is the whole of the rule and dropping it is the single
   * easiest thing here to get wrong.** This call was unconditional, which was
   * correct when the sheet only ever opened *after* a join. It no longer does:
   * a rider who taps `Join later` never joined, so recording a dismissal for
   * that club would silence the members-only prompt if they are admitted by
   * another door later in the same session — an introduction suppressed on a
   * fact the rider never asserted. Their answer was *"I am not joining"*, not
   * *"I am a member and I am not introducing myself"*, and only the second is
   * what this store means.
   *
   * The sheet is what knows, because it is the thing whose write returned, so
   * the answer arrives as `onDismiss`'s argument rather than being re-read from
   * a cache this would have to race.
   *
   * The write stays OUTSIDE the updater and reads `current` from this render,
   * which is the same `queue[0]` the sheet was showing. Inside, it would be a
   * side effect in a function React requires to be pure:
   * `dismissIntroductionPrompt` ends in `notify()`, which synchronously calls
   * every `useSyncExternalStore` listener, and StrictMode invokes updaters
   * twice on purpose to surface exactly this.
   */
  const advance = (recordDismissal: boolean) => {
    if (recordDismissal && current) dismissIntroductionPrompt(current)
    setClubIds((queue) => queue.slice(1))
  }

  return { current, enqueue, advance }
}
