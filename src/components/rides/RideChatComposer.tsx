'use client'

import { useRef, useState, useTransition } from 'react'
import { PaperPlaneIcon } from '@/components/icons/generated'
import { RIDE_MESSAGE_MAX_LENGTH } from '@/lib/validation/rides'
import { cn } from '@/lib/utils'

/**
 * The `Reply` bar from `Ride - Chat` (`2226:4999`) and its focused variant in
 * `Ride - Chat - Text focus` (`2242:11086`).
 *
 * Measured: an 80px bar on `Grey/10` with a `Grey/10%` top hairline, holding a
 * 326×40 field and a 40×40 `Accent Brand/100` send button with a 24px Paper
 * Plane. The horizontal numbers only add up at 8px padding and an 8px gap
 * (8 + 326 + 8 + 40 + 8 = 390), which is why they are not the 16px the rest of
 * the app uses.
 *
 * **The focused variant is 56px, not 80**, and the field turns `White/100` from
 * `Grey/5`. Both are reproduced on `:focus-within`. The height change is drawn
 * for the iOS keyboard — the bar tightens when the keyboard takes the bottom
 * half of the screen — and it is worth having on the web for the same reason,
 * where the visual viewport shrinks identically.
 *
 * ## Why this is a bare input rather than `<Input>`
 *
 * `Input` is `Input / Text`: a 72px bordered box with its label *inside*, above
 * the value. That is the form field this app uses everywhere and it is not what
 * the design draws here — a 40px unlabelled pill is a different component, and
 * bending the primitive into it would leave every form carrying the bend.
 * Extending `src/components/ui/*` is the rule for a control the app will reuse;
 * this one exists on exactly one screen.
 *
 * ## Sending
 *
 * The id is generated **here** and handed to `onSend`, which is what lets the
 * message be drawn immediately and reconciled against the server row when it
 * arrives — see `sendRideMessage`. On failure the text comes back into the
 * field: a rider's own words are the one thing that must survive a refusal, the
 * same rule `CommentForm` follows.
 */
export function RideChatComposer({
  onSend,
  disabled,
}: {
  /** Resolves to an error message, or `null` when the message landed. */
  onSend: (body: string, messageId: string) => Promise<string | null>
  disabled?: boolean
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fieldRef = useRef<HTMLInputElement>(null)

  const canSend = body.trim().length > 0 && !pending && !disabled

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSend) return

    const sending = body
    // Cleared before the round trip, not after: the message is already drawn in
    // the thread by the time this resolves, so leaving it in the field too would
    // show it twice. Restored below if it never landed.
    setBody('')
    setError(null)

    startTransition(async () => {
      const failure = await onSend(sending, crypto.randomUUID())
      if (!failure) return

      setError(failure)
      // Only if the rider has not started typing the next one — overwriting what
      // they are in the middle of writing to restore what they wrote before is a
      // worse outcome than losing the failed text, and they can still see it in
      // the error.
      setBody((current) => (current === '' ? sending : current))
      fieldRef.current?.focus()
    })
  }

  return (
    <form
      onSubmit={submit}
      // `pb-safe` rather than the design's flat 8: this bar sits at the true
      // bottom of the viewport — the chat screen is the one place the nav bar is
      // hidden — so on a notched device it owes the home-indicator inset that
      // `Navbar` would otherwise have paid.
      className="pb-safe shrink-0 border-t border-border bg-track px-2 pt-5 transition-[padding] focus-within:pt-2"
    >
      {error && (
        // Above the field rather than below it: below is where the keyboard is,
        // and a message drawn under a focused input on a phone is a message
        // nobody reads. `role="status"` unconditionally would be wrong here —
        // the region is created with its content, which assistive tech misses —
        // so it is `alert`, which is announced on insertion.
        <p role="alert" className="px-2 pb-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={fieldRef}
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          // The database refuses anything longer (`034`) and
          // `rideMessageBodySchema` says so in words; this stops the rider
          // reaching either by typing.
          maxLength={RIDE_MESSAGE_MAX_LENGTH}
          disabled={disabled}
          aria-label="Message"
          placeholder="Message the crew"
          className={cn(
            'h-10 min-w-0 flex-1 rounded-lg bg-background px-3 text-base text-foreground outline-none transition-colors',
            'placeholder:text-muted/70 focus:bg-surface disabled:opacity-50'
          )}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors',
            'active:bg-accent-strong disabled:opacity-40'
          )}
        >
          <PaperPlaneIcon className="h-6 w-6" />
        </button>
      </div>
    </form>
  )
}
