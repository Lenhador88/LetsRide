import { cn } from '@/lib/utils'
import { InputHTMLAttributes, ReactNode, forwardRef, useId } from 'react'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode
}

/**
 * A real `<input type="checkbox">` — required so a Server Action can read it
 * from `FormData` (e.g. the signup consent checkbox as `acceptedTerms`), and
 * so it works with keyboard and screen readers without extra ARIA wiring.
 * The 20x20 box is a decorative, `aria-hidden` sibling driven by the `peer`
 * variant; the input itself is visually hidden (`sr-only`), not removed.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId

    return (
      <label htmlFor={inputId} className={cn('inline-flex cursor-pointer items-start gap-3', className)}>
        <span
          className={cn(
            'relative inline-flex h-5 w-5 shrink-0',
            // Invisible hit-area expansion: 20x20 is the measured Figma size,
            // but CLAUDE.md's accessibility floor asks for a 44x44 minimum
            // touch target even when the frame is tighter. -12px each side
            // brings 20px up to 44px without growing the visible box.
            'before:absolute before:-inset-3 before:content-[""]'
          )}
        >
          <input ref={ref} type="checkbox" id={inputId} className="peer sr-only" {...props} />
          <span
            aria-hidden="true"
            // Checked is brand green, not near-black. Measured from the "Sign up
            // — Checkbox checked" frame: the box fills Accent Brand/100 and the
            // border goes green with it. This is one of the sanctioned uses of
            // the accent (success/active), not a button fill.
            className="absolute inset-0 rounded border-2 border-foreground bg-transparent transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
          />
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100"
          >
            <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {label && <span className="pt-0.5 text-sm font-medium text-foreground">{label}</span>}
      </label>
    )
  }
)

Checkbox.displayName = 'Checkbox'
