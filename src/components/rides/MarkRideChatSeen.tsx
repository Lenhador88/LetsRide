'use client'

import { useEffect } from 'react'
import { markRideChatSeen } from '@/lib/actions/ride-messages'

/**
 * Advances this rider's read watermark for a ride's chat while they are reading
 * it (`061`, PD-120).
 *
 * Renders nothing. `MarkClubSeen`'s shape, and the reason that shape survives is
 * the same one: **the chat screen mounts this conditionally, on `isCrew`**, so
 * "only a crew member marks a thread read" is expressed by whether the component
 * is on the page rather than by a condition inside an effect that runs anyway.
 * The database refuses the write regardless — `061`'s WITH CHECK requires the
 * ride's own audience — so the conditional mount is an optimisation and the
 * policy is the enforcement.
 *
 * ## Two triggers, and the second is what PD-119 made necessary
 *
 * Live delivery shipped before this did, so the common case is that the rider is
 * *looking at the thread* when the next message lands. A mark written only on
 * mount means the dot lights the instant they tap back to the ride plan, showing
 * them a message they watched arrive — the single most visible way this feature
 * can be wrong, and the normal path rather than an edge case.
 *
 * So the effect keys on `[rideId, newestMessageId]`. `rideId` alone would not
 * re-fire; the message id changes exactly once per arrival, because the chat
 * screen refetches the thread on every one.
 *
 * **It is the newest *rendered* message, never the subscription callback.** The
 * callback fires when a row reaches the database, so marking there would mark
 * read a message the rider has not been shown. Keying on what the thread
 * actually rendered means the mark can only ever lag the rider's eyes.
 *
 * ## The third condition the proposal did not have
 *
 * A phone in a pocket with the chat mounted still receives messages, still
 * renders them, and would still advance the watermark — so the rider returns to
 * a cleared badge for messages nobody looked at. `document.visibilityState` is
 * the gate, and the `visibilitychange` listener is what makes it a *deferral*
 * rather than a loss: coming back to the tab marks what arrived while it was
 * hidden, which is the moment those messages are genuinely on screen.
 *
 * This is the one rule here that is not in
 * `openspec/changes/add-ride-chat-unread/`; it was added at build time and the
 * delta spec was extended to match, rather than the code quietly exceeding the
 * contract.
 *
 * ## Failure
 *
 * Silent, and the direction is the safe one: an unwritten watermark lights the
 * dot again on the next visit, which over-reports unread rather than hiding a
 * message. The write is an idempotent upsert of a server-imposed timestamp, so a
 * double fire costs one request and changes nothing.
 */
export function MarkRideChatSeen({
  rideId,
  /**
   * The id of the last message the thread is currently drawing, or `undefined`
   * while it is still loading or the chat is empty.
   *
   * **Empty is not "nothing to mark".** A rider opening a chat with no messages
   * has still read it to the end, and the watermark is what stops the next
   * message being compared against `joined_at` instead. So the effect fires on
   * mount regardless, and this only ever adds further firings.
   */
  newestMessageId,
}: {
  rideId: string
  newestMessageId: string | undefined
}) {
  useEffect(() => {
    if (!rideId) return

    const mark = () => {
      // `visibilityState` rather than `hasFocus()`: focus is lost to a dialog or
      // another window on the same screen, where the thread is still perfectly
      // readable and the rider is plausibly reading it.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void markRideChatSeen(rideId)
    }

    mark()

    // Fires when the rider comes back to a tab that received messages while it
    // was hidden — which is the moment those messages are actually on screen,
    // and the only thing that keeps the gate above from losing the mark instead
    // of deferring it.
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [rideId, newestMessageId])

  return null
}
