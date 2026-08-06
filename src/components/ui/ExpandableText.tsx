'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A block of prose clamped to three lines with a `Show more` toggle.
 *
 * Promoted out of `rides/RideDescription`, which is where it was first built,
 * because the profile draws the identical control: the ride blurb clamps to 60px
 * against a 20px line height and so does `Profile / View your profile / Profile`
 * → `Description` (342×92, text 342×60, `Show more` at Poppins/12/Medium). Two
 * screens drawing one control is what `src/components/ui/` is for; a second copy
 * would be the thing that drifts.
 *
 * The toggle only renders once the paragraph is confirmed to overflow three
 * lines — `scrollHeight > clientHeight` while `line-clamp-3` is applied is the
 * standard way to detect a clamp actually engaging, and it is read from a
 * `ResizeObserver` rather than a one-shot measurement so it stays right across
 * a viewport resize, which changes how many lines the same string needs without
 * changing the string.
 *
 * **It does not cover the font swap, and an earlier revision of this comment
 * claimed it did.** `ResizeObserver` fires on border-box change, and a
 * `line-clamp-3` paragraph at a pinned `line-height` (`text-sm` fixes it at
 * 1.25rem) keeps the same box when only the wrapped-line count changes. A
 * string needing 4 lines in the fallback face and 3 in Poppins stops
 * overflowing with no box change and so no callback, leaving the button on
 * unclamped text — the exact defect this measurement exists to remove.
 * `next/font/google` defaults to `display: 'swap'`, so the swap is real rather
 * than theoretical. The window is narrow and the failure is one stale button,
 * so it is left open deliberately; `document.fonts.ready` is the hook that
 * closes it.
 * The observer is paused (not disconnected) while expanded: with the clamp
 * class removed, `clientHeight` grows to match `scrollHeight` and the
 * difference the check relies on collapses to ~0, which would hide the button
 * — and the way back to "Show less" — the instant it succeeded at its job.
 *
 * Starts with the button hidden and `overflowing` false. This is a
 * `'use client'` component, but CLAUDE.md's "read in an effect, never during
 * render" still applies: Next still server-renders it on first load, and that
 * pass has no DOM to measure — `scrollHeight`/`clientHeight` do not exist yet.
 * Hidden-by-default means the SSR HTML and the first hydrated frame agree (no
 * mismatch to reconcile) and a short description never shows a dead control,
 * even for the one frame before the effect runs; the cost is a genuinely long
 * description not offering the toggle until just after mount, which is the
 * cheaper of the two wrong answers.
 */
export function ExpandableText({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = textRef.current
    if (!el) return

    function measure() {
      if (expanded) return // clamp is off; scrollHeight/clientHeight would agree either way
      setOverflowing(el!.scrollHeight - el!.clientHeight > 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [expanded])

  return (
    <div className={cn('flex flex-col', className)}>
      <p
        ref={textRef}
        className={cn('text-sm text-foreground', !expanded && 'line-clamp-3')}
      >
        {children}
      </p>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="self-start py-1.5 text-xs font-medium text-muted"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
