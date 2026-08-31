'use client'

import { useState, useTransition } from 'react'
import { PostcardActionButton } from '@/components/postcards/PostcardAction'
import { cn } from '@/lib/utils'

export type OptimisticToggleProps = {
  pressed: boolean
  count: number
  /**
   * The accessible name, as a function of the CURRENT count. Called with this
   * component's own live state — never the `count` prop directly — so it
   * stays right through an optimistic tap. It must not branch on `pressed`:
   * `LikeButton`'s own history is the reason. It used to flip to "Unlike…"
   * when liked, and a toggle button that both reports `pressed` and renames
   * itself to the undo action announces "Unlike, 5 likes, pressed" — a
   * control named for undoing, reported as done. `aria-pressed` below is the
   * whole of the non-visual signal, so the word never moves; only the count
   * legitimately does.
   */
  label: (count: number) => string
  /** The glyph, as a function of the CURRENT pressed state — never the
   *  `pressed` prop, which a caller cannot read once this component owns the
   *  optimistic state. */
  icon: (pressed: boolean) => React.ReactNode
  /**
   * The write. Returns `{ error }` rather than throwing, matching every
   * function in `lib/actions/` — a thrown rejection would leave the
   * optimistic state stuck forward with nothing to roll it back to.
   */
  onToggle: (next: boolean) => Promise<{ error: string | null }>
  className?: string
}

/**
 * `LikeButton`'s two-state optimistic toggle, extracted rather than copied —
 * `client-render-shell`'s "An optimistic control SHALL state what it is" and
 * "the toggle exists once" (`club-timeline-engagement`, PD-356). Both rules
 * that broke once already, on `LikeButton` itself (see its own docstring),
 * now live here and nowhere else:
 *
 * - **`aria-pressed` is the whole of the non-visual signal.** The accessible
 *   name never flips between the verb and its undo — see `label` above.
 * - **A refused write rolls the local state back** and surfaces its message
 *   absolutely positioned, so a failed tap cannot reflow the row it sits in.
 * - **Nothing is retried or queued.** An offline tap fails and says so.
 *
 * Renders through `PostcardActionButton` — the app's one reaction-pill
 * shape, despite the name. This is its first caller outside `postcards/`,
 * and the cross-directory import is deliberate rather than a slip: the
 * alternative is a second copy of the shape's classes free to drift from
 * this one, which is exactly the defect `PostcardAction.tsx`'s own header
 * records happening once already, over the padding.
 */
export function OptimisticToggle({
  pressed,
  count,
  label,
  icon,
  onToggle,
  className,
}: OptimisticToggleProps) {
  const [isPressed, setIsPressed] = useState(pressed)
  const [n, setN] = useState(count)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle() {
    const next = !isPressed
    setIsPressed(next)
    setN((current) => current + (next ? 1 : -1))
    setError(null)

    startTransition(async () => {
      const result = await onToggle(next)
      if (result.error) {
        setIsPressed(!next)
        setN((current) => current + (next ? -1 : 1))
        setError(result.error)
      }
    })
  }

  return (
    <>
      <PostcardActionButton
        onClick={toggle}
        pressed={isPressed}
        count={n}
        label={label(n)}
        className={cn(pending && 'opacity-70', className)}
        icon={icon(isPressed)}
      />
      {error && (
        // Absolutely placed so a failed toggle cannot reflow the row it sits
        // in and shift the controls beside it out from under a rider's thumb
        // — `LikeButton`'s own rule, unchanged by the extraction.
        <p role="status" className="absolute -top-5 left-2 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  )
}
