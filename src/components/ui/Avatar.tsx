import { cn, getInitials } from '@/lib/utils'

interface AvatarProps {
  src?: string | null
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  className?: string
}

/**
 * `xs` is the design's `v2 / Component / Avatar` Size=Small (24px) — the byline
 * avatar on a postcard. The larger sizes predate the snapshot and are still the
 * v1 scale; the design's own set is 24 / 28 / 32, so these get reconciled when
 * the screens using them migrate rather than renumbered under live callers.
 *
 * `2xl` is **not** from that component set: it is the profile hero, measured off
 * `Profile / View your profile / Profile` → `Avatar` at 128×128 holding a 120px
 * image. The 4px difference is a ring, and it is `White/100` there rather than
 * the `Grey/20%` every other size carries — which is why the profile page passes
 * `border-surface`, and why that is an override at the call site rather than a
 * second `ring` constant here for one screen.
 */
const sizes = {
  xs: 'h-6 w-6 text-[0.5rem]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-xl',
  '2xl': 'h-32 w-32 text-2xl',
}

// Every avatar in the v2 library carries a 2px Grey/20% ring, drawn inside the
// circle so the image is inset by it rather than the box growing.
const ring = 'border-2 border-border-strong'

export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('rounded-full object-cover', ring, sizes[size], className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-foreground/10 font-semibold text-foreground',
        ring,
        sizes[size],
        className
      )}
    >
      {getInitials(name)}
    </div>
  )
}
