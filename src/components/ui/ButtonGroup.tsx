'use client'

import { cn } from '@/lib/utils'

/**
 * The segmented control — `v2 / Component / Button Group`.
 *
 * Measured from the **frame** (`Ride - Ride plan (Details)`, `2375:8771`), not
 * the component set, because the two disagree and the frame is what this screen
 * ships: the set's `Theme=Light` draws a `Grey/5` track with a `White/100`
 * selected pill and a Semibold label, while the detached frame draws a
 * `Grey/10` track with a `Grey/100` pill and a **Medium** label. Track 358×40
 * radius 10, 2px padding; buttons 118×36, 16px horizontal padding; the selected
 * pill takes radius 8 and the others radius 3.
 *
 * ACCESSIBILITY: the unselected label is `Grey/80` on the `Grey/10` track,
 * which measures **4.17:1** — below the 4.5:1 AA bar for a 14px medium label.
 * Drawn that way and left that way; see docs/FIGMA-FIDELITY-TODO.md §Ride
 * detail, where it sits beside the same problem on the two RSVP pills.
 */
export function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  options: { value: T; label: string }[]
  /** `null` is a real state — nothing chosen yet — and draws no selected pill. */
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
  /** Names the group for screen readers; there is no visible <legend>. */
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex gap-0 rounded-[10px] bg-track p-0.5', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-9 flex-1 px-4 text-sm font-medium transition-colors disabled:opacity-60',
              selected
                ? 'rounded-lg bg-foreground text-surface'
                : 'rounded-[3px] text-muted active:bg-black/5'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
