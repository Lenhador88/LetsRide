'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { Textarea } from '@/components/ui/Textarea'
import { introduceToClub, joinAndIntroduceToClub } from '@/lib/actions/club-introductions'
import {
  CLUB_INTRODUCTION_COPY,
  CLUB_INTRODUCTION_MAX_LENGTH,
  CLUB_INTRODUCTION_PARTIAL_FAILURE,
  CLUB_INTRODUCTION_STARTER,
} from '@/lib/validation/clubs'

/**
 * Which sheet this is — PD-392. **Required at every call site, with no
 * default.**
 *
 * A default would be `member`, and a caller that forgot to pass the mode would
 * draw *"Welcome to the club!"* over a rider who has not joined anything — the
 * precise defect this change exists to remove, reintroduced silently. A
 * required prop is one nobody can forget; the cost is that
 * `IntroductionPrompt.test.tsx` had to change, which is the right way round.
 */
export type IntroductionPromptMode = 'pre-join' | 'member'

/**
 * "Welcome to the club" — the sheet a rider owed an introduction sees on the
 * club detail screen (`097`, PD-365), and, since PD-392, the sheet a rider sees
 * *before* joining one.
 *
 * Product owner, 2026-09-01: *"when the user presses 'join club', there should
 * be a popup, welcome to club.... this and that! … Then an input for
 * 'Introduction to be posted' something like that?"* — and 2026-09-03: *"I
 * would rather have a post or join later (join later will not join the club for
 * now)"*.
 *
 * **There is no v2 frame for this.** Composition is ours, on `ContextMenu`'s
 * scrim and geometry — the bottom sheet every other club overflow already
 * uses — rather than a new primitive for one screen.
 *
 * ## Two modes, and the mode is a fact about the membership
 *
 * | | `pre-join` | `member` |
 * |---|---|---|
 * | Opened by | a tap on a Join control, for a club owing an introduction | `showIntroductionPrompt` — a membership with no introduction |
 * | `Post` | joins, **then** introduces | introduces |
 * | Second control | `Join later` — writes nothing, joins nothing | `Not now` — unchanged since `097` |
 *
 * **Member mode is byte-for-byte what it was**, because `097`'s sheet is
 * correct for a rider who is already a member however they got there: an
 * approved join request (`085`), a claimed invite link (`093`), `058`'s welcome
 * club, an invite acceptance, or creating the club. For every one of those,
 * `Join later` would be a lie — the membership is somebody else's action.
 *
 * ## The state lives HERE, not in the body, and that is `ContextMenu`'s doing
 *
 * `097` split this into a wrapper and `IntroductionPromptBody` purely as a test
 * seam, and left the form state in the body. PD-392 cannot: dismissal has to be
 * inert while the membership write is in flight, and two of the three ways to
 * dismiss — the scrim and Escape — belong to `ContextMenu`, which this wrapper
 * owns. The choice was a second copy of the pending flag up here or one copy
 * with the body made presentational, and a duplicated flag that can disagree
 * with itself is exactly the failure the lock exists to prevent. So the body is
 * controlled, which also makes each state directly assertable rather than
 * reachable only by simulating typing.
 *
 * ## The latch — and why it is per instance
 *
 * Pre-join becomes member the moment **this sheet's own** join succeeds, and
 * never goes back. It is not read from the cache: `joinClub` calls
 * `invalidateClubMembership` and the refetch resolves on its own schedule, so
 * between the join returning and the club query landing a cache-reading sheet
 * still says `Join later` about a membership that exists. The sheet issued the
 * write; it does not need to be told.
 *
 * **It must not be hoisted to the page.** A sheet instance is one club —
 * Explore keys it `key={introducingClubId}` and the club detail is a single
 * club by construction — so per-instance already means per-(rider, club). A
 * page-level latch would leak club A's answer into club B: after A's `Post`
 * lands, B's sheet would open in member mode and call `introduceToClub` alone,
 * which `097` refuses for a non-member. B would become unjoinable, and the
 * failure would surface as an introduction error rather than as anything about
 * joining.
 *
 * ## `onDismiss` carries the membership fact out
 *
 * The page is what records the session dismissal, and the rule is an iff —
 * *record if and only if a membership exists at that moment*. Only the sheet
 * knows: it is the thing whose write returned. So the answer goes out with the
 * dismissal rather than being re-derived from a cache the page would have to
 * race. `design.md` §D2 and §D3.
 *
 * ## Q1 and Q3 — both `097` invariants hold in BOTH modes
 *
 * **Post is inert until the field holds non-whitespace text**, and **the
 * starter is a `placeholder`, never a `defaultValue`.** The second matters more
 * in pre-join mode than it did before: a prefilled value is never empty, so
 * `Post` would be live the instant the sheet opened, and one tap would now both
 * ship the canned sentence and **join a club**. Both spellings screenshot
 * identically; `IntroductionPrompt.test.tsx` is what a refactor swapping them
 * fails.
 */
export function IntroductionPrompt({
  clubId,
  mode,
  open,
  onDismiss,
  onPosted,
}: {
  clubId: string
  /** Required — see `IntroductionPromptMode`. */
  mode: IntroductionPromptMode
  open: boolean
  /**
   * The second control, the scrim and Escape all close the sheet this way, per
   * `ContextMenu`.
   *
   * **`membershipExists` is the iff's predicate**, and it is `true` for every
   * dismissal of a member-mode sheet and for a pre-join sheet whose own join
   * has landed. The caller records a session dismissal exactly when it is set,
   * and nothing otherwise: a rider who declined to join has asserted nothing
   * about introducing themselves later.
   */
  onDismiss: (membershipExists: boolean) => void
  /** Called once the introduction is actually stored. The caller closes the
   *  sheet on it; this component does not decide that for itself. */
  onPosted: () => void
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // The latch. One-way, per instance, and never derived from a read — see the
  // header. A failed introduction does not reset it, because the membership
  // does not go away.
  const [joined, setJoined] = useState(false)
  const membershipExists = mode === 'member' || joined

  // Inert from `Post` until the MEMBERSHIP write resolves, and no longer. Once
  // the membership exists the sheet is in member mode, where `097`'s standing
  // rule is "always present and always closes the sheet, pending or not" —
  // holding it shut for the introduction's flight would contradict that. The
  // window this covers is the one where a dismissal labelled `Join later` could
  // land over a join that has already committed.
  const dismissLocked = !membershipExists && pending

  function dismiss() {
    if (dismissLocked) return
    onDismiss(membershipExists)
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      if (membershipExists) {
        const result = await introduceToClub(clubId, body)
        if (result.error) {
          setError(result.error)
          return
        }
        onPosted()
        return
      }

      const result = await joinAndIntroduceToClub(clubId, body)
      if (result.outcome === 'join-failed') {
        // Nothing was written and the rider is still not a member, so the sheet
        // stays exactly as it was — `Join later` still means what it says and
        // `Post` may be pressed again.
        setError(result.error)
        return
      }

      // Both remaining outcomes mean the membership landed, so the latch flips
      // before anything else: it is what relabels the second control and what
      // `onDismiss` reports out.
      setJoined(true)

      if (result.outcome === 'introduction-failed') {
        // The one string that says half of a `Post` succeeded. The bare
        // introduction error here would tell the rider nothing happened under a
        // control labelled `Join later`, when in fact they joined.
        setError(CLUB_INTRODUCTION_PARTIAL_FAILURE)
        return
      }

      onPosted()
    })
  }

  return (
    <ContextMenu open={open} onClose={dismiss} label="Introduce yourself to the club">
      <IntroductionPromptBody
        mode={membershipExists ? 'member' : 'pre-join'}
        value={body}
        onValueChange={setBody}
        error={error}
        pending={pending}
        dismissDisabled={dismissLocked}
        onDismiss={dismiss}
        onSubmit={submit}
      />
    </ContextMenu>
  )
}

/**
 * The form — split out of `IntroductionPrompt` above so it can be rendered and
 * asserted on without a `ContextMenu` in the tree, which renders nothing at all
 * under `typeof document === 'undefined'` (always, under this repo's
 * `environment: 'node'` Vitest config). Exported for that test seam and for no
 * other reason; the two only ever appear together in the app.
 *
 * **Presentational and fully controlled** — every piece of state is the
 * wrapper's, for the reason its header gives: the dismissal lock has to be
 * visible to `ContextMenu`'s scrim and Escape handlers, which live up there,
 * and one flag in one place beats two that can disagree.
 *
 * The two `097` invariants this file is pinned on are both here and both hold
 * in either mode: `Post` is disabled on non-whitespace-empty text, and
 * `CLUB_INTRODUCTION_STARTER` is a `placeholder` while `value` starts and stays
 * whatever the wrapper says.
 */
export function IntroductionPromptBody({
  mode,
  value,
  onValueChange,
  error,
  pending,
  dismissDisabled,
  onDismiss,
  onSubmit,
}: {
  mode: IntroductionPromptMode
  value: string
  onValueChange: (value: string) => void
  error: string | null
  pending: boolean
  /** True only while a pre-join `Post`'s membership write is in flight. */
  dismissDisabled: boolean
  onDismiss: () => void
  onSubmit: () => void
}) {
  const copy = CLUB_INTRODUCTION_COPY[mode]

  return (
    <>
      <h2 className="text-lg font-semibold text-foreground">{copy.heading}</h2>
      <p className="mt-1 text-sm font-medium text-muted">{copy.body}</p>

      <Textarea
        className="mt-4"
        rows={4}
        maxLength={CLUB_INTRODUCTION_MAX_LENGTH}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        // The starter, as a PLACEHOLDER — see this file's header. `value` above
        // is the wrapper's and starts `''` until the rider types.
        placeholder={CLUB_INTRODUCTION_STARTER}
        error={error ?? undefined}
        disabled={pending}
        // No `autoFocus`, deliberately. In member mode the sheet is driven by
        // STATE (§D7), so it opens on ANY navigation to a club this rider owes
        // an introduction to — and focusing the textarea there raises the mobile
        // keyboard over the screen they actually navigated to. The textarea is
        // already the visually dominant element; focus costs nothing it needs.
      />

      <div className="mt-4 flex gap-3">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          // Only ever set in pre-join mode, while the membership write is out —
          // see the wrapper. Member mode keeps `097`'s "always present and
          // always closes the sheet, pending or not".
          disabled={dismissDisabled}
          onClick={onDismiss}
        >
          {copy.dismiss}
        </Button>
        <Button
          type="button"
          className="flex-1"
          loading={pending}
          disabled={value.trim().length === 0}
          onClick={onSubmit}
        >
          Post
        </Button>
      </div>
    </>
  )
}
