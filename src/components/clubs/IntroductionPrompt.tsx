'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { Textarea } from '@/components/ui/Textarea'
import { introduceToClub } from '@/lib/actions/club-introductions'
import {
  CLUB_INTRODUCTION_MAX_LENGTH,
  CLUB_INTRODUCTION_STARTER,
} from '@/lib/validation/clubs'

/**
 * "Welcome to the club" — the sheet a rider owed an introduction sees on the
 * club detail screen (`097`, PD-365). Product owner, 2026-09-01: *"when the
 * user presses 'join club', there should be a popup, welcome to club.... this
 * and that! … Then an input for 'Introduction to be posted' something
 * like that?"*
 *
 * **There is no v2 frame for this.** Composition is ours, on `ContextMenu`'s
 * scrim and geometry — the bottom sheet every other club overflow already
 * uses — rather than a new primitive for one screen.
 *
 * **Split into a thin wrapper and `IntroductionPromptBody`, and the split is
 * a test seam rather than a style.** `ContextMenu` renders through a portal
 * and refuses to draw anything at all where `document` does not exist
 * (`typeof document === 'undefined'`) — which is always, under this repo's
 * `environment: 'node'` Vitest config (`vitest.config.ts`'s own header: jsdom
 * is the answer only once something needs a layout or an event, and adding it
 * for one component test is not that). So the form itself — the one thing Q1
 * and Q3 are about — is a separate component with no `ContextMenu` in its own
 * tree, and `IntroductionPrompt.test.tsx` renders that directly.
 */
export function IntroductionPrompt({
  clubId,
  open,
  onDismiss,
  onPosted,
}: {
  clubId: string
  open: boolean
  /** `Not now`, the scrim, and Escape — all three close the sheet the same
   *  way, per `ContextMenu`. */
  onDismiss: () => void
  /** Called once the introduction is actually stored. The caller closes the
   *  sheet on it; this component does not decide that for itself. */
  onPosted: () => void
}) {
  return (
    <ContextMenu open={open} onClose={onDismiss} label="Introduce yourself to the club">
      <IntroductionPromptBody clubId={clubId} onDismiss={onDismiss} onPosted={onPosted} />
    </ContextMenu>
  )
}

/**
 * The form — split out of `IntroductionPrompt` above purely so it can be
 * rendered and asserted on without a `ContextMenu` in the tree. Exported for
 * exactly that test seam and for no other reason; the two only ever appear
 * together in the app.
 *
 * ## `introduceToClub` is a plain two-argument function, not
 * `(prevState, formData)`
 *
 * So this is `ClubMembershipButton`'s shape (`useTransition` plus local error
 * state) rather than `useActionState`: the sheet has to react to success by
 * closing itself, which a form submission alone does not signal cleanly, and
 * there is nowhere for this write to navigate to.
 *
 * ## Q1 — mandatory but dismissible, and the two rules that make it so
 *
 * **Post is inert until the field holds non-whitespace text.** "Mandatory"
 * never means the sheet cannot be dismissed — a modal a rider could not close
 * would trap somebody already in the club behind a write that can fail for
 * reasons that have nothing to do with them.
 *
 * **`Not now` is always present and always closes the sheet**, pending or
 * not. It writes nothing and dismisses for this club for the rest of the
 * session (`lib/clubs/introduction-dismissal.ts`) — the caller owns that call,
 * not this component, because the caller is also what decides whether to show
 * the sheet again.
 *
 * ## Q3 — the starter is a `placeholder`, never a `defaultValue`
 *
 * `CLUB_INTRODUCTION_STARTER` guides a rider who does not know what to write,
 * but the field's VALUE starts empty. A prefilled value is never empty, so
 * Post would be live the instant the sheet opens and one tap would ship the
 * canned sentence, unedited, into every club — repealing the rule above in
 * silence. Both spellings screenshot identically; `IntroductionPrompt.test.tsx`
 * is what a refactor swapping them fails.
 */
export function IntroductionPromptBody({
  clubId,
  onDismiss,
  onPosted,
}: {
  clubId: string
  onDismiss: () => void
  onPosted: () => void
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await introduceToClub(clubId, body)
      if (result.error) {
        setError(result.error)
        return
      }
      onPosted()
    })
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-foreground">Welcome to the club!</h2>
      <p className="mt-1 text-sm font-medium text-muted">
        Say hello — the club can read it, wave and reply.
      </p>

      <Textarea
        className="mt-4"
        rows={4}
        maxLength={CLUB_INTRODUCTION_MAX_LENGTH}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        // The starter, as a PLACEHOLDER — see this file's header. `value`
        // above starts and stays `''` until the rider types.
        placeholder={CLUB_INTRODUCTION_STARTER}
        error={error ?? undefined}
        disabled={pending}
        // No `autoFocus`, deliberately. The sheet is driven by STATE, not by
        // the Join button (§D7), so it opens on ANY navigation to a club this
        // rider owes an introduction to — and focusing the textarea there
        // raises the mobile keyboard over the screen they actually navigated
        // to. The dismissal is per-session, so a new session repeats it. The
        // textarea is already the visually dominant element; focus costs
        // nothing it needs.
      />

      <div className="mt-4 flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onDismiss}>
          Not now
        </Button>
        <Button
          type="button"
          className="flex-1"
          loading={pending}
          disabled={body.trim().length === 0}
          onClick={submit}
        >
          Post
        </Button>
      </div>
    </>
  )
}
