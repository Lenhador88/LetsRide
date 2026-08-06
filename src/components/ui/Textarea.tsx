import { cn } from '@/lib/utils'
import { TextareaHTMLAttributes, forwardRef, useId } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

/**
 * The multi-line counterpart to `Input`, and deliberately a copy of its box
 * treatment — the same 2px border, surface fill, inside-the-box label and
 * green focus ring measured from `Input / Text State=Focus`.
 *
 * Figma has no textarea component that has been read: the caption field lives
 * on the create-postcard screen, one of the frames the rate limit has kept
 * shut. Reusing a verified box rather than inventing a second one is the
 * smaller guess, but the height and whether the design even boxes this field
 * are unverified — see docs/FIGMA-FIDELITY-TODO.md §Create postcard.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, disabled, ...props }, ref) => {
    const generatedId = useId()
    const textareaId = id ?? generatedId
    const errorId = error ? `${textareaId}-error` : undefined

    return (
      <div className="flex w-full flex-col gap-1.5">
        <div
          className={cn(
            'flex w-full flex-col gap-1 rounded-lg border-2 border-border bg-surface px-4 py-3 transition-colors focus-within:border-accent',
            disabled && 'opacity-50'
          )}
        >
          {label && (
            <label htmlFor={textareaId} className="text-sm font-medium text-muted">
              {label}
            </label>
          )}
          <textarea
            ref={ref}
            id={textareaId}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={cn(
              // `resize-none`: the native drag handle is a desktop affordance with
              // no touch equivalent, and Figma draws no resize control on any
              // frame using this box (caption, ride description/route, bio) — all
              // are a fixed height on a 390px frame. A caller that genuinely wants
              // a taller box sets `rows`, not a rider dragging a corner.
              'w-full resize-none bg-transparent text-base text-foreground outline-none placeholder:text-muted disabled:cursor-not-allowed',
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'
