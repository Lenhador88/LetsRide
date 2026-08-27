'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
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
 * destination. Logged in the PR body as a deviation with nothing to deviate
 * from.
 *
 * ## The three states, and the one that is not an error
 *
 * `sendFeedback` navigates nowhere, so its success has to be rendered — it is
 * the fourth action in the app to need `ActionState.sent` (see that field's own
 * comment, which names the first three). Success swaps the form for a thank-you
 * and leaves the sheet open, because a sheet that vanishes on submit gives the
 * rider no evidence anything happened.
 *
 * **Consecutive successes are indistinguishable by value**, which that field's
 * comment warns about — so the effect below compares the state object's
 * identity rather than `state.sent`, and the composer is cleared on a fresh
 * success rather than on every render where `sent` happens to be true.
 *
 * ## Nothing is optimistic and nothing is cached
 *
 * There is no cache key to invalidate and no read to refetch: `084` grants the
 * app no way to read this table back at all. The rider's own submission is
 * therefore not visible to them anywhere afterwards, which is why the
 * confirmation copy is the whole receipt.
 */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const online = useOnlineStatus()
  const [state, formAction, pending] = useActionState(sendFeedback, emptyActionState)
  const [body, setBody] = useState('')
  const lastSent = useRef(state)

  useEffect(() => {
    // Identity, not `state.sent` — two successes in a row carry the same value,
    // so a value comparison would never fire the second time.
    if (state !== lastSent.current && state.sent) {
      lastSent.current = state
      setBody('')
    }
  }, [state])

  const done = state.sent === true

  function close() {
    onClose()
    // The sheet is mounted for the life of `/profile`, so a second opening
    // would otherwise land on the previous submission's thank-you. Reopening
    // must be a fresh form; `useActionState` has no reset, so the composer is
    // cleared here and `done` follows the action's own state.
    setBody('')
  }

  return (
    <ContextMenu open={open} onClose={close} label="Send feedback">
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
          <Button type="button" variant="secondary" size="md" onClick={close}>
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
            <Button type="button" variant="secondary" size="md" onClick={close} disabled={pending}>
              Cancel
            </Button>
          </form>
        )}
      </div>
    </ContextMenu>
  )
}
