'use client'

import { useEffect, useRef } from 'react'
import { cn, formatRideMessageDay, formatRideTime } from '@/lib/utils'
import type { RideChatMessage } from '@/types'

/**
 * The bubble list from `Ride - Chat` (`2226:4999`).
 *
 * Measured off the frame rather than inferred:
 *
 * - **Your messages are `Grey/100` with `White/100` text; everyone else's are
 *   `Grey/10` with `Grey/100`.** Note which way round that is — the design gives
 *   the *dark* bubble to the sender, which is the opposite of several popular
 *   messaging apps and therefore the thing most likely to be "corrected" by
 *   someone building from memory.
 * - The author name (`Poppins/14/Semibold`) appears **only on other riders'
 *   bubbles**, and only on the first of a run — the frame's `Section` grouping.
 *   Your own name never appears; you know who you are.
 * - The time (`Poppins/12/Medium`) sits **inside** every bubble, below the text,
 *   at `White/50%` on your own and `Grey/80` on others'.
 * - Bubbles are 294 wide against a 374 row, so ~78% — `max-w-[78%]`.
 * - Rows are 8 apart within a `Section` and the sections themselves further; the
 *   grouped spacing below reproduces that with 2 and 8.
 *
 * The frame draws a small `Corner` vector — a tail — on every bubble. It is not
 * reproduced: it is an 8×12 path that would need an SVG per bubble and per side,
 * and at 8px it reads as a rounding artifact rather than as a tail. Logged in
 * docs/FIGMA-FIDELITY-TODO.md rather than silently dropped.
 *
 * ## Scrolling
 *
 * A chat opens at the newest message, not the oldest, so the scroller is pinned
 * to the bottom on mount and on every arrival. `behavior: 'auto'` on the first
 * pass and `'smooth'` afterwards: animating the initial jump means the rider
 * watches the whole thread fly past before landing, which reads as a bug.
 */
export function RideChatThread({ messages }: { messages: RideChatMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: settled.current ? 'smooth' : 'auto' })
    settled.current = true
  }, [messages.length])

  return (
    <ol className="flex flex-1 flex-col overflow-y-auto px-2 py-4">
      {messages.map((message) => (
        <li
          key={message.id}
          className={cn(
            'flex flex-col',
            message.startsGroup ? 'mt-2 first:mt-0' : 'mt-0.5',
            message.mine ? 'items-end' : 'items-start'
          )}
        >
          {message.startsDay && (
            // Not in the design — see `formatRideMessageDay` for why it is added
            // and what it costs. Rendered inside the same `li` as the message it
            // precedes so the list stays one item per message, which is what a
            // screen reader is counting.
            <p className="w-full py-3 text-center text-xs font-medium text-muted">
              {formatRideMessageDay(message.created_at)}
            </p>
          )}

          <div
            className={cn(
              'flex max-w-[78%] flex-col gap-0.5 rounded-lg px-3 py-2',
              message.mine ? 'bg-foreground' : 'bg-track',
              // Only while the database has not acknowledged it. A *failed* send
              // never reaches this state — the row is withdrawn and the text
              // goes back in the composer.
              message.pending && 'opacity-60'
            )}
          >
            {!message.mine && message.startsGroup && (
              <p className="text-sm font-semibold text-foreground">
                {/* A profile the viewer cannot read comes back null — blocked,
                    or a rider still mid-onboarding with no username. The message
                    still renders rather than vanishing, exactly as the crew list
                    keeps the row. */}
                {message.author?.username ?? 'Rider'}
              </p>
            )}

            {/* `whitespace-pre-wrap` because a rider's line breaks are content.
                `break-words` because a pasted URL is one 300-character word and
                would otherwise push the bubble past the screen. */}
            <p
              className={cn(
                'text-base break-words whitespace-pre-wrap',
                message.mine ? 'text-surface' : 'text-foreground'
              )}
            >
              {message.body}
            </p>

            <p
              className={cn(
                'text-xs font-medium',
                // `White/50%` on your own bubble, `Grey/80` on everyone else's.
                // The first has no token — it is an opacity on white rather than
                // a palette entry — so it is expressed as one.
                message.mine ? 'text-surface/50' : 'text-muted'
              )}
            >
              {/* Reuses the ride's own time formatter rather than getting a
                  twin: both draw `HH:mm` in `APP_TIME_ZONE`, and this file's
                  rule about per-screen formatters exists for designs that
                  genuinely differ. See `formatRideMessageDay`. */}
              {formatRideTime(message.created_at)}
            </p>
          </div>
        </li>
      ))}
      {/* The scroll target. A zero-height sentinel rather than scrolling the
          container to `scrollHeight`, which is off by the composer's height
          whenever the bar has just changed size on focus. */}
      <div ref={endRef} />
    </ol>
  )
}
