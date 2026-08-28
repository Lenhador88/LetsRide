'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { Textarea } from '@/components/ui/Textarea'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { sendFeedback } from '@/lib/actions/feedback'
import { emptyActionState } from '@/lib/actions/state'
import { FEEDBACK_BODY_MAX_LENGTH } from '@/lib/validation/feedback'

/**
 * The composer behind `ProfileMenu`'s **Feedback** row — PD-321.
 *
 * ## Why a sheet rather than a route
 *
 * `DeleteAccountSheet`'s shape, for `ProfileMenu`'s own reason: a second
 * `ContextMenu` over the same `/profile` canvas, not `/profile/feedback`. There
 * is no Figma frame for feedback at all, so this follows the nearest existing
 * pattern rather than inventing a screen — and one textarea and a Send is not a
 * destination.
 *
 * ## Success has to be rendered, and that is what makes the reset necessary
 *
 * `sendFeedback` navigates nowhere, because there is nowhere to go: nothing in
 * the app can read a feedback row back, so the confirmation is the whole
 * receipt. It is the fourth action to need `ActionState.sent` (see that field's
 * own comment, which now names all four).
 *
 * **`useActionState` has no reset, and this component is mounted for the life
 * of `/profile`** — `ProfileMenu` renders it unconditionally and `ContextMenu`
 * unmounts only its children when closed. So the hook's state outlives the
 * sheet, and a first version of this file cleared the textarea on close and
 * believed that was enough: `state.sent` stayed true, the sheet reopened on the
 * thank-you with no composer, and a rider could file **one report per visit to
 * the screen**. On the one feature whose entire value is riders being able to
 * report things.
 *
 * The fix is the form living in a child with a `key` that changes on close, so
 * closing genuinely discards the hook. Clearing state by hand cannot work here
 * — the value that has to go is inside `useActionState`.
 *
 * ## Nothing is optimistic and nothing is cached
 *
 * There is no cache key to invalidate and no read to refetch: `084` grants the
 * app no way to read this table back.
 */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Bumped on every close, which is what remounts `FeedbackForm` below and
  // gives the next opening a fresh `useActionState`.
  const [attempt, setAttempt] = useState(0)

  function close() {
    onClose()
    setAttempt((n) => n + 1)
  }

  return (
    <ContextMenu open={open} onClose={close} label="Send feedback">
      <FeedbackForm key={attempt} onClose={close} />
    </ContextMenu>
  )
}

function FeedbackForm({ onClose }: { onClose: () => void }) {
  const online = useOnlineStatus()
  const [state, formAction, pending] = useActionState(sendFeedback, emptyActionState)
  const [body, setBody] = useState('')

  const done = state.sent === true

  return (
    <div className="flex flex-col gap-6 pb-2">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-foreground">
          {done ? 'Thanks' : 'Send feedback'}
        </h2>
        <p className="text-sm text-muted">
          {done
            ? 'Your message is with us. We read every one, and we cannot reply from here yet.'
            : 'Tell us what is broken, confusing or missing. We cannot reply from here yet.'}
        </p>
      </div>

      {done ? (
        <Button type="button" variant="secondary" size="md" onClick={onClose}>
          Close
        </Button>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <Textarea
            name="body"
            label="Your feedback"
            rows={5}
            maxLength={FEEDBACK_BODY_MAX_LENGTH}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="What happened?"
            required
          />

          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
          {!online && (
            <p className="text-xs font-medium text-muted">
              You’re offline — reconnect to send this.
            </p>
          )}

          <Button
            type="submit"
            size="md"
            loading={pending}
            disabled={!online || body.trim().length === 0}
          >
            Send
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  )
}
