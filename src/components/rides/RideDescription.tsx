'use client'

import { useState } from 'react'

/**
 * The ride blurb with its `Show more` control.
 *
 * The design clamps the text to 60px against a 20px line height — exactly three
 * lines — and puts a `Button / Link / Secondary` under it. Three lines is the
 * measurement, not a guess.
 *
 * Client-side because the toggle is the whole point; the text itself is passed
 * in already rendered by the server page.
 */
export function RideDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex flex-col px-6">
      <p
        className={expanded ? 'text-sm text-foreground' : 'line-clamp-3 text-sm text-foreground'}
      >
        {description}
      </p>
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
