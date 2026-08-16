'use client'

import { useState } from 'react'
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
  // task 7.4 (`client-cache-invalidation`'s "a signed URL whose object is
  // gone renders the fallback"). A cached row can hold a signed URL for an
  // object account deletion or a club transfer already removed — D2 nulls
  // both club image paths and deletes the objects the instant ownership
  // changes, and a departed rider's own avatar goes the same way. The URL
  // itself does not expire early, so the browser's `error` event is the only
  // signal this ever happened; without it the `<img>` renders broken until
  // the surrounding screen next revalidates.
  //
  // Keyed on `src` rather than a plain boolean: a `broken` flag that never
  // resets would keep drawing initials for a LATER, valid `src` this
  // component gets re-rendered with — a fresh signed URL after `setQueryData`
  // replaces one, say — since React reuses this component instance rather
  // than remounting it when only a prop changes.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)

  if (src && src !== brokenSrc) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setBrokenSrc(src)}
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
