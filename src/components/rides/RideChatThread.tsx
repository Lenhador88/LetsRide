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
 * - The time (`Poppins/12/Medium`) sits **inside** every bubble, below the text.
 *   On your own it is `White/50%` — a real style in the file. On everyone else's
 *   the frame gives a **raw `#000000` with no fill style attached**, so it
 *   resolves to the nearest v2 token in intent, `Grey/100` (`text-foreground`).
 *   An earlier revision of this line said `Grey/80` and the code matched it;
 *   that is 4.17:1 on `Grey/10` and fails WCAG AA for 12px/500, so it would have
 *   *added* a contrast failure under a policy that exists to keep the drawn ones
 *   and add none. `Grey/100` measures 12.65:1. Read from
 *   `design/frames/rides-view-ride-ride-chat.json`, not from the tree dump,
 *   which prints the style name and not the literal fill.
 * - Bubbles are 294 wide against a 374 row, so ~78% — `max-w-[78%]`.
 * - Rows are 8 apart within a `Section` and the sections themselves further; the
 *   grouped spacing below reproduces that with 2 and 8.
 *
 * Two things the frame has that this does not, both logged in
 * docs/FIGMA-FIDELITY-TODO.md rather than silently dropped:
 *
 * - The `Corner` tail vector on every bubble — an 8×12 path needing an SVG per
 *   bubble per side, which at 8px reads as a rounding artifact.
 * - **Per-rider author-name colours.** The frame gives each rider their own
 *   untokenised fill (`Pedro Abreu` `#CC4429`, `Julia Windfield` `#1A804D`),
 *   which is a group-chat name-colouring feature rather than a stray. Drawn in
 *   `Grey/100` here because `#CC4429` on `Grey/10` is 3.45:1 and fails AA at
 *   14px semibold — so building it as drawn would ship an unreadable name. It
 *   is a designer question, not a decision this file should make quietly.
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
    // The scroller is the wrapper, not the list, so the scroll sentinel below
    // can be a sibling of the `ol` rather than a `div` child of it — only `li`,
    // `script` and `template` are permitted there, which is the same rule that
    // put the day separator *inside* its `li` further down.
    <div className="flex flex-1 flex-col overflow-y-auto px-2 py-4">
      <ol className="flex flex-col">
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
                // `White/50%` on your own bubble — no token, it is an opacity
                // on white rather than a palette entry, so it is expressed as
                // one. `Grey/100` on everyone else's, which is what the frame's
                // untokenised black resolves to. NOT `text-muted`: see above.
                message.mine ? 'text-surface/50' : 'text-foreground'
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
      </ol>
      {/* The scroll target. A zero-height sentinel rather than scrolling the
          container to `scrollHeight`, which is off by the composer's height
          whenever the bar has just changed size on focus. */}
      <div ref={endRef} />
    </div>
  )
}
