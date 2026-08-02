import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

// `Button / Regular / *` in Figma — filled or outlined, full width at the
// measured size (`lg` = Regular/Primary 56px, `md` = Regular/Secondary 40px).
// `link` is `Button / Link / Secondary` — an inline, content-width back link
// (136x32 / 72x32 depending on label), never a full-width CTA, so its own
// classes below override whatever `size` would otherwise apply.
//
// The Figma sets DO carry State=Down variants, and they were checked: for
// Primary and Secondary the pressed variant is pixel-identical to the default
// — the design draws no colour change. The hover/active shades below are
// therefore a web-only addition (the designs are mobile, where hover does not
// exist), not a match to anything measured. `danger` is measured: its
// State=Down is Warning/110, which is `--color-danger-strong`.
const variants: Record<Variant, string> = {
  // Primary is near-black (Grey/100), not green — green is a sparing accent, never the default fill.
  primary: 'bg-foreground text-white hover:bg-foreground/90 active:bg-foreground/80',
  secondary: 'bg-surface text-foreground border border-border-strong hover:bg-background active:bg-background',
  ghost: 'bg-transparent text-foreground hover:bg-foreground/5 active:bg-foreground/10',
  // Warning labels are Semibold in Figma, unlike every other button label.
  danger: 'bg-danger font-semibold text-white hover:bg-danger-strong active:bg-danger-strong',
  link: 'relative h-8 w-auto justify-start gap-1.5 px-0 text-sm bg-transparent text-foreground hover:opacity-70 active:opacity-60 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[""]',
}

// `sm` and `md` are both below the 44x44 glove-friendly minimum in
// CLAUDE.md's accessibility floor (`md` = the measured 40px Regular/Secondary
// height). Rather than growing the visible box past what Figma measured, an
// invisible `::before` extends the *hit* area to 44px without moving a pixel
// of the rendered button. `lg` (56px) already clears the floor.
const sizes: Record<Size, string> = {
  sm: 'relative h-9 px-4 text-sm before:absolute before:inset-x-0 before:-inset-y-1 before:content-[""]',
  md: 'relative h-10 w-full px-4 text-sm before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[""]',
  lg: 'h-14 w-full px-4 text-base',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled disabled:text-disabled-foreground',
          sizes[size],
          variants[variant],
          className
        )}
        {...props}
      >
        {loading && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
