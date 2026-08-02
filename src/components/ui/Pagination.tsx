import { cn } from '@/lib/utils'

interface PaginationProps {
  /** Number of steps/dots to render. The login wizard passes 2 (photo step deferred) —
   *  never hardcode a count here. */
  total: number
  /** Zero-indexed: 0 is the first step. */
  current: number
  className?: string
}

/**
 * Wizard step indicator — `Pagination` in Figma. Purely a status display (the
 * dots are not individually interactive), so it renders as a labelled
 * progressbar rather than a row of buttons.
 */
export function Pagination({ total, current, className }: PaginationProps) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      aria-label={`Step ${current + 1} of ${total}`}
      className={cn('flex items-center gap-2', className)}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn('h-2 w-2 rounded-full transition-colors', i === current ? 'bg-foreground' : 'bg-border-strong')}
        />
      ))}
    </div>
  )
}
