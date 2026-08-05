'use client'

import { useEffect } from 'react'
import { CheckIcon, CloseIcon } from '@/components/icons/generated'
import { cn } from '@/lib/utils'

/**
 * The confirmation toast — measured from `Account blocked banner` (`2303:6169`):
 * 358×64 at 16px inset, radius 8, `White/100`, 16px padding, 12px gap, with a
 * 32×32 `Accent Brand/100` circle carrying a white check, then the message in
 * Poppins/16/Semibold `Grey/100`.
 *
 * The design draws it at y63 of a 390×844 frame — overlapping the header rather
 * than pushing it down, which is what makes it a toast rather than a banner in
 * the layout sense, despite the layer name.
 *
 * **It has no dismiss control and no drawn duration.** The three frames that use
 * it (`Postcard hidden`, `Account blocked`, `Post reported`) each show it in one
 * state with nothing to close it, so the timeout below is ours. Four seconds is
 * long enough to read six words and short enough not to sit over the feed;
 * logged in docs/FIGMA-FIDELITY-TODO.md rather than presented as measured.
 */
const DISMISS_AFTER_MS = 4000

export function Banner({
  message,
  tone = 'success',
  onDismiss,
}: {
  message: string
  /**
   * The design only ever draws the success form — a green circle and a check.
   * `error` reuses the same geometry with `Warning/100` and a cross, because a
   * failed action reported under a green tick is worse than an undrawn state.
   */
  tone?: 'success' | 'error'
  onDismiss: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS)
    return () => clearTimeout(timer)
    // `message` is in the deps so a second confirmation restarts the clock
    // rather than inheriting the remainder of the first one's.
  }, [message, onDismiss])

  return (
    <div
      // `status` rather than `alert`: these confirm something the rider just
      // did, so they should not interrupt what a screen reader is saying.
      role="status"
      className="pt-safe fixed inset-x-4 top-0 z-[80] flex items-center gap-3 rounded-lg bg-surface p-4 shadow-lg"
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent-foreground',
          tone === 'error' ? 'bg-danger' : 'bg-accent'
        )}
      >
        {tone === 'error' ? <CloseIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
      </span>
      <p className="text-base font-semibold text-foreground">{message}</p>
    </div>
  )
}
