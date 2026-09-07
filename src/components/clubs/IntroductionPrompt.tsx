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
 * | Primary | `Join club` — joins, **then** introduces if there is text | `Post` — introduces |
 * | Primary inert when empty | **no** (PD-418) | yes (`097` Q1) |
 * | Field starts | carrying `CLUB_INTRODUCTION_STARTER` (PD-418) | empty, with it as a placeholder |
 * | Second control | `Cancel` — writes nothing, joins nothing | `Not now` — unchanged since `097` |
 *
 * ## PD-418 — the introduction stopped being the price of membership
 *
 * Product owner, 2026-09-06: *"we should lift the mandatory rule that the user
 * needs to fill an introduction. Instead, there is a default text, that the user
 * can just press join, and it fill that intro with a default text."*
 *
 * Three things move together and none of them works alone: the field opens
 * **prefilled** so one tap sends something rather than nothing, the primary is
 * **never inert** so a rider who clears it can still join, and the primary says
 * **`Join club`** so it names the thing that always happens. A prefill without
 * the second is the old wall with a shortcut; the second without the third is a
 * control called `Post` that posts nothing.
 *
 * **The single-identical-sentence failure is real and is priced.** A club
 * timeline of one repeated line reads as spam, which is the opposite of what an
 * introduction is for. What holds it back is that the default is an *editable
 * value* rather than a silent server-side fill: the rider sees it, the cursor is
 * in it, and sending it is a deliberate act. If it ever does flood a club, the
 * lever is the copy, not the mechanism.
 *
 * **Member mode is byte-for-byte what it was**, because `097`'s sheet is
 * correct for a rider who is already a member however they got there: an
 * approved join request (`085`), a claimed invite link (`093`), `058`'s welcome
 * club, an invite acceptance, or creating the club. For every one of those,
 * `Cancel` would be a lie — the membership is somebody else's action.
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
 * still offers `Cancel` about a membership that exists. The sheet issued the
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
 * ## Q1 and Q3 — `097`'s invariants now hold in MEMBER MODE, and that is the
 * change, not a weakening
 *
 * Until PD-418 both modes held *`Post` is inert until the field holds
 * non-whitespace text* and *the starter is a `placeholder`, never a
 * `defaultValue`*. Pre-join mode now holds neither, deliberately, and the
 * argument that made them right there has been spent rather than overruled:
 * PD-392 needed them because `Post` was the only door to a **membership**, so a
 * prefilled value plus a live control meant one tap could join a club and ship a
 * canned sentence into it. The membership is no longer behind the text, so all
 * one tap can now do is send a sentence the rider is looking at.
 *
 * **Member mode keeps both, unchanged and asserted separately**, because there
 * the text is the only thing the sheet produces. `IntroductionPrompt.test.tsx`
 * pins the two modes independently — a refactor that "unifies" them fails it,
 * which is the point: the asymmetry is load-bearing.
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
  /**
   * **`null` is "the rider has not touched the field", not "empty".** That
   * distinction is the whole prefill mechanism — see `body` below — and it is
   * the same `null`-versus-`undefined` discipline the rest of this app applies
   * to a decided answer against a missing one.
   */
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // The latch. One-way, per instance, and never derived from a read — see the
  // header. A failed introduction does not reset it, because the membership
  // does not go away.
  const [joined, setJoined] = useState(false)
  const membershipExists = mode === 'member' || joined

  /**
   * The field's value — the rider's draft once they have touched it, and the
   * mode's own default until then (PD-418).
   *
   * **Derived from the `mode` PROP, never from `membershipExists`.** The prop is
   * stable for the life of one open sheet; the latch flips mid-flight the
   * instant a pre-join `Join club` lands. Keying the default off the latch would
   * blank an untouched field the moment the join succeeded — visible on the
   * `introduction-failed` path, which is the one path that keeps the sheet open
   * afterwards.
   *
   * **Computed rather than seeded into state in an effect**, which is what the
   * obvious implementation does. The club detail screen mounts ONE sheet element
   * and flips its `mode` from `member` to `pre-join` when the join control is
   * tapped (`clubs/detail/page.tsx`, `key={id}`), so a `useState` initialiser
   * would capture `member` at mount and the prefill would never appear on the
   * screen it matters most on. A derived value re-reads the prop every render
   * and has no such window.
   */
  const body = draft ?? (mode === 'pre-join' ? CLUB_INTRODUCTION_STARTER : '')

  // Inert from `Post` until the MEMBERSHIP write resolves, and no longer. Once
  // the membership exists the sheet is in member mode, where `097`'s standing
  // rule is "always present and always closes the sheet, pending or not" —
  // holding it shut for the introduction's flight would contradict that. The
  // window this covers is the one where a dismissal labelled `Cancel` could
  // land over a join that has already committed.
  const dismissLocked = !membershipExists && pending

  function dismiss() {
    if (dismissLocked) return
    // The draft is released with the sheet, so reopening it starts from the
    // mode's default again rather than from whatever the rider left behind. The
    // latch is deliberately NOT reset — it is one-way, per the header.
    setDraft(null)
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
        setDraft(null)
        onPosted()
        return
      }

      // The latch flips from the callback, NOT from the resolved result — the
      // join lands first and the introduction may still be in flight after it,
      // and both the control's label and the dismissal lock have to move at that
      // instant rather than at the end. Reading it off the result would collapse
      // one pending window over both writes, which keeps the pre-join labels on
      // screen over a committed join and holds the sheet shut past the rule that
      // releases it.
      const result = await joinAndIntroduceToClub(clubId, body, () => setJoined(true))
      if (result.outcome === 'join-failed') {
        // Nothing was written and the rider is still not a member, so the sheet
        // stays exactly as it was — `Cancel` still cancels and `Join club` may be
        // pressed again.
        setError(result.error)
        return
      }

      // The latch is already true — the callback above set it the moment the
      // join landed. This is idempotent (React bails out on an identical value)
      // and keeps the END state right on the `introduction-failed` path.
      //
      // It is NOT a fallback for a caller that passes no callback, and reading
      // it as one is how the fix above gets undone: without the callback the
      // latch would flip only after BOTH writes resolve, which leaves the end
      // state correct and the TIMING wrong — the pre-join labels on screen over
      // a committed join, and the dismissal lock held past the membership write.
      // The timing is the whole point, which is why the callback is required
      // rather than optional.
      setJoined(true)

      // **PD-418 — joined, and the rider chose to say nothing.** They are a
      // member, so the dismissal iff's predicate is satisfied and the caller
      // records the session dismissal exactly as it would for a `Not now`. That
      // is what stops the club detail's state-driven sheet reopening on arrival
      // and asking again for the thing they just declined — `097`'s
      // "joined, owes an introduction" is a first-class state, and this is now
      // the ORDINARY way into it rather than a failure path.
      //
      // `onDismiss` rather than `onPosted` because nothing was posted, and
      // `onPosted`'s callers record the dismissal unconditionally — which would
      // be right here by luck and wrong in what it claims.
      if (result.outcome === 'joined-without-introduction') {
        setDraft(null)
        onDismiss(true)
        return
      }

      if (result.outcome === 'introduction-failed') {
        // The one string that says half of a `Join club` succeeded. The bare
        // introduction error here would tell the rider nothing happened, when in
        // fact they are now a member.
        setError(CLUB_INTRODUCTION_PARTIAL_FAILURE)
        return
      }

      setDraft(null)
      onPosted()
    })
  }

  return (
    <ContextMenu open={open} onClose={dismiss} label="Introduce yourself to the club">
      <IntroductionPromptBody
        mode={membershipExists ? 'member' : 'pre-join'}
        value={body}
        onValueChange={setDraft}
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
 * and one flag in one place beats two that can disagree. **The prefill is the
 * wrapper's too**, and this component must never grow a default of its own:
 * `value` is whatever it is handed, including the starter.
 *
 * The two `097` invariants this file is pinned on are both here and both are now
 * scoped to **member mode** — `Post` disabled on non-whitespace-empty text, and
 * `CLUB_INTRODUCTION_STARTER` as a `placeholder`. See the wrapper's Q1/Q3
 * section for why pre-join holds neither.
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
        // The starter as a PLACEHOLDER in member mode only. In pre-join mode the
        // wrapper hands the same string down as the `value`, so a placeholder
        // there would be dead markup that only ever shows on a field the rider
        // has deliberately cleared — where the hint to write something is
        // exactly what they just refused. See `CLUB_INTRODUCTION_STARTER`.
        placeholder={mode === 'member' ? CLUB_INTRODUCTION_STARTER : undefined}
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
          // **Pre-join is never disabled by the text — PD-418.** The control
          // joins whether or not there is anything to say, so gating it on the
          // field is the mandatory-introduction wall this story removes; a rider
          // who clears the field and taps it joins and writes no thread.
          //
          // **Member mode keeps `097`'s Q1 rule**, and it is not an inconsistency
          // to reconcile: there the text is the only product, so an enabled
          // control over an empty field would promise a post that cannot happen.
          disabled={mode === 'member' && value.trim().length === 0}
          onClick={onSubmit}
        >
          {copy.submit}
        </Button>
      </div>
    </>
  )
}
