import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  /**
   * Visually flags the field's border as invalid. Off by default: the login
   * spec is explicit that field borders must not turn red — the app can't
   * tell the rider which field was wrong, and saying so would leak whether
   * an account exists. Passing `error` alone only renders the message below
   * the field; callers that do want a red border (e.g. a live
   * username-taken check in onboarding) opt in explicitly.
   */
  errorBorder?: boolean
}

/**
 * `Input / Text` in Figma — a single 310x72 bordered box with the label
 * *inside* it, stacked above the value (not a label-above-field layout).
 * The outer 2px stroke + white background is what produces the "inset
 * white fill" look in the spec; no extra inner element is needed for that.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, errorBorder, id, disabled, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const errorId = error ? `${inputId}-error` : undefined

    return (
      <div className="flex w-full flex-col gap-1.5">
        <div
          className={cn(
            // Focus is brand green, measured from the Input/Text `State=Focus`
            // variant (Accent Brand/100, 2px) — not a darkened Grey. Green is
            // the accent for active states; this is one of them.
            'flex h-[72px] w-full flex-col justify-center gap-1 rounded-lg border-2 border-border bg-surface px-4 py-3 transition-colors focus-within:border-accent',
            disabled && 'opacity-50',
            errorBorder && 'border-danger focus-within:border-danger'
          )}
        >
          {label && (
            <label htmlFor={inputId} className="text-sm font-medium text-muted">
              {label}
            </label>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={cn(
              'w-full border-0 bg-transparent p-0 text-base text-foreground outline-none placeholder:text-muted/70 disabled:cursor-not-allowed',
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

Input.displayName = 'Input'
