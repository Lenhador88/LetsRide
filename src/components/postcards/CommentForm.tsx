'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { addComment } from '@/lib/actions/comments'
// Seed state comes from the plain module, never from the `'use server'` one — a
// const exported from there takes the route down at module evaluation. See
// lib/actions/state.ts and the incident in docs/HANDOFF.md.
import { emptyActionState } from '@/lib/actions/state'
import { COMMENT_BODY_MAX_LENGTH } from '@/lib/validation/comments'

/**
 * The composer. Not optimistic, unlike `LikeButton`, and the difference is the
 * point: a like is a two-state toggle worth showing before the server agrees,
 * while a comment is text a rider has composed — showing it as posted and then
 * retracting it when RLS refuses would be worse than a moment of pending.
 * `addComment` revalidates the thread, so the real row arrives on its own.
 *
 * The submit button is disabled on an empty body, so the schema's "Write
 * something first." is unreachable from here — it stays the server's guard
 * against everything that is not this form.
 *
 * Composition is inferred: the design's comment composer is one of the frames
 * the Figma rate limit has kept shut. See docs/FIGMA-FIDELITY-TODO.md §Comments.
 */
export function CommentForm({ postcardId }: { postcardId: string }) {
  const [state, formAction, pending] = useActionState(addComment, emptyActionState)
  const [body, setBody] = useState('')
  const [handled, setHandled] = useState(state)

  // Clearing the box on success, adjusted during render rather than in an
  // effect. This is React's documented "reset state when something changes"
  // pattern: the re-render happens before the browser paints, so the composer
  // never flashes the posted text back at the rider — and it does not trip
  // react-hooks/set-state-in-effect, which is right that an effect here would
  // be a cascading render for no reason.
  //
  // Compares object identity rather than reading `sent` alone: two successful
  // comments in a row both carry `sent: true`, and only the fresh object
  // useActionState returns from each submit tells them apart. A *failed*
  // submit deliberately leaves the text where it is — the rider's words are
  // the one thing that must survive a refusal.
  if (state !== handled) {
    setHandled(state)
    if (state.sent) setBody('')
  }

  const remaining = COMMENT_BODY_MAX_LENGTH - body.length

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="postcardId" value={postcardId} />

      <Textarea
        name="body"
        label="Add a comment"
        rows={3}
        maxLength={COMMENT_BODY_MAX_LENGTH}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Say something about this photo."
        error={state.error ?? undefined}
        // Locked for the round trip, not just the button. Text typed while the
        // submit is in flight was never in the FormData that went, and the
        // clear-on-success above would throw it away — so the honest thing is
        // to refuse it rather than to lose it.
        disabled={pending}
      />

      {/* Only warns near the limit — a counter on an empty field is noise, and
          maxLength already makes overrun impossible. Mirrors the caption field. */}
      {remaining <= 100 && <p className="-mt-1 text-xs text-muted">{remaining} characters left</p>}

      <Button type="submit" size="md" loading={pending} disabled={body.trim().length === 0}>
        Post comment
      </Button>
    </form>
  )
}
