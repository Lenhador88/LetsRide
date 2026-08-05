'use client'

import { useState } from 'react'
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
 * Client-side because the toggle is the whole point; the text is passed in
 * already rendered by the server page.
 */
export function ExpandableText({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn('flex flex-col', className)}>
      <p className={cn('text-sm text-foreground', !expanded && 'line-clamp-3')}>{children}</p>
      {/* Rendered unconditionally: whether the text actually overflows three
          lines is a layout fact the server cannot know (it depends on the
          rendered width and the font), so hiding the control "when short" would
          need a measurement pass. Toggling a short description is harmless. */}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="self-start py-1.5 text-xs font-medium text-muted"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}
