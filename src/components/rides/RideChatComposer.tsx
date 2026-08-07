'use client'

import { useRef, useState, useTransition } from 'react'
import { PaperPlaneIcon } from '@/components/icons/generated'
import { RIDE_MESSAGE_MAX_LENGTH } from '@/lib/validation/rides'
import { cn } from '@/lib/utils'

/**
 * The message id, chosen here so an optimistic bubble and the server row can be
 * recognised as the same message — see `sendRideMessage`.
 *
 * Isolated so its one failure mode has one home: `crypto.randomUUID` is
 * **undefined outside a secure context**, and `http://<lan-ip>:3000` is exactly
 * how this app gets opened on a real phone. `crypto.getRandomValues` IS
 * available there, so the fallback is a real v4 rather than a weaker id.
 */
function newMessageId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

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
}: {
  /** Resolves to an error message, or `null` when the message landed. */
  onSend: (body: string, messageId: string) => Promise<string | null>
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fieldRef = useRef<HTMLInputElement>(null)

  const canSend = body.trim().length > 0 && !pending

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSend) return

    const sending = body
    // Generated BEFORE the field is cleared, because it can throw:
    // `crypto.randomUUID` is undefined outside a secure context, which is
    // exactly how a device test over `http://192.168.x.x:3000` runs. Clearing
    // first meant the rider's text vanished, no error rendered, no bubble
    // appeared, and the rejection went unhandled inside `startTransition`.
    let messageId: string
    try {
      messageId = newMessageId()
    } catch {
      setError('This browser cannot send messages over an insecure connection.')
      return
    }

    // Cleared before the round trip, not after: the message is already drawn in
    // the thread by the time this resolves, so leaving it in the field too would
    // show it twice. Restored below if it never landed.
    setBody('')
    setError(null)

    startTransition(async () => {
      // `onSend` resolves rather than rejects by contract, but a bug on the
      // other side of it must not become an unhandled rejection that leaves the
      // composer locked with the rider's text gone.
      const failure = await onSend(sending, messageId).catch(
        () => 'Could not send that message. Try again.'
      )
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
        // `danger-strong` (`Warning/110`), not `danger`. `Warning/100` #D92140
        // on this bar's `Grey/10` ground is 3.60:1, under the 4.5:1 bar for
        // 12px/500 — and this is the one string a rider reads when a send is
        // refused, so it is the worst place in the screen to be unreadable.
        // #99001A measures 6.45:1 on the same ground. Not one of the four
        // documented AA failures; a new pairing, so it does not get to inherit
        // "left exactly as drawn".
        <p role="alert" className="px-2 pb-2 text-xs font-medium text-danger-strong">
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
          aria-label="Message"
          placeholder="Message the crew"
          className={cn(
            'h-10 min-w-0 flex-1 rounded-lg bg-background px-3 text-base text-foreground outline-none transition-colors',
            'placeholder:text-muted/70 focus:bg-surface'
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
