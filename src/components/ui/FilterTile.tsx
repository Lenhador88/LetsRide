'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { cn, getInitials } from '@/lib/utils'

/**
 * `v2 / Component / Filter Bar / Item` and the `List` frame that holds it —
 * measured from the committed snapshot, not chosen.
 *
 * Every number here is read: the bar's row is 16/8 padded, each item is an 80×88
 * column, the label is Poppins/10/Medium under the image, and the selected ring
 * is a 2px Accent Brand stroke sitting 4px outside the image — which is why the
 * ring box is 72 for a 64 circle and 68 for a 60 square.
 *
 * This lives in `ui/` because the Postcards and Rides bars are two instances of
 * one component set, not two components. They were briefly two copies; the tile
 * is the part that must not drift, since the ring geometry is the only thing
 * telling a selected tile from an unselected one.
 *
 * **Riders are circles, clubs are rounded squares — the shape used to be the
 * only thing telling them apart, and PD-284 is the product owner asking for
 * more:** *"Apply same styling as in club list? Banner + pic?"* A club tile now
 * draws `FilterClubImage` below, which borrows `ClubCard`'s cover-behind,
 * avatar-in-front composition rather than a single flat image — so the two
 * kinds now differ in composition as well as outline, which is legible at 56px
 * in a way a 4px corner radius is not. The shape distinction itself is
 * untouched: still a deliberate, recorded choice, not something this changes.
 */
export function FilterBar({
  label,
  children,
}: {
  /** Names the control for screen readers — "Filter rides", "Filter postcards". */
  label: string
  children: React.ReactNode
}) {
  return (
    <nav
      aria-label={label}
      // `overflow-x-auto` with the padding inside the scroller so the last tile
      // can reach the right edge instead of stopping 16px short of it.
      className="flex shrink-0 gap-0 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </nav>
  )
}

/**
 * A rider tile is 64px and round; a club tile is 60px and rounded-8. The club is
 * deliberately the smaller of the two so the two shapes read as the same optical
 * size — measured, not a rounding error.
 */
export function FilterTile({
  href,
  label,
  count,
  selected,
  shape,
  children,
}: {
  href: string
  label: string
  count: number
  selected: boolean
  shape: 'circle' | 'square'
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? 'true' : undefined}
      // No Figma State=Focus on this tile either — same rationale as
      // `ButtonGroup`'s ring, added for the keyboard/WebKit case the design
      // never drew rather than left to the browser default.
      className="group flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="relative flex h-[68px] w-[68px] items-center justify-center">
        <div
          className={cn(
            'overflow-hidden bg-border',
            shape === 'circle' ? 'h-16 w-16 rounded-full' : 'h-[60px] w-[60px] rounded-lg'
          )}
        >
          {children}
        </div>

        {selected && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute border-2 border-accent',
              shape === 'circle' ? 'h-[72px] w-[72px] rounded-full' : 'h-[68px] w-[68px] rounded-xl'
            )}
          />
        )}

        {count > 0 && (
          // The badge sits in a Grey/5 ring so it reads against the photo behind it.
          <span className="absolute -top-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-background">
            <span
              className={cn(
                'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold text-white',
                selected ? 'bg-accent' : 'bg-foreground'
              )}
            >
              {count}
            </span>
          </span>
        )}
      </div>

      <span className="w-16 truncate text-center text-2xs font-medium text-foreground">{label}</span>
    </Link>
  )
}

/**
 * A club tile's image (PD-284) — `ClubCard`'s cover-behind, avatar-in-front
 * composition, scaled into the 60px square `FilterTile` gives a club.
 *
 * **The degrade for "no cover" is deliberate, not a blank banner.** A club
 * without a cover has nothing to put *behind* the avatar, so the composite is
 * skipped entirely and the avatar (or its initials) fills the whole tile —
 * exactly what this tile drew before PD-284. That is also why a cover that
 * fails to load falls back the same way rather than leaving an empty square:
 * `brokenCover` mirrors `ClubCard`'s own pattern for a signed URL whose object
 * a since-nulled `cover_image_path` or a 404 leaves stale.
 *
 * **`bg-surface` on the `Avatar` override is load-bearing, not decorative.**
 * `Avatar`'s own fallback background is `bg-foreground/10` — translucent, so
 * over the cover photo behind it the initials chip would let the photo bleed
 * through and "read as a smudge" (`ClubCard`'s own words for the identical bug
 * it already shipped once). `border-surface` for the same reason: a white ring
 * that reads against any cover colour, matching `ClubCard`'s avatar exactly.
 *
 * Initials over that opaque white — `text-foreground` `#1A1A1A` on
 * `bg-surface` `#FFFFFF` — measure **17.4:1**, the same pairing `ClubCard` and
 * every other initials fallback in this app already carries.
 */
export function FilterClubImage({
  name,
  avatarUrl,
  coverUrl,
}: {
  name: string
  avatarUrl: string | null
  coverUrl: string | null
}) {
  const [brokenCover, setBrokenCover] = useState<string | null>(null)
  const showCover = !!coverUrl && coverUrl !== brokenCover

  if (!showCover) {
    return avatarUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
    ) : (
      <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-foreground">
        {getInitials(name)}
      </span>
    )
  }

  return (
    <div className="relative h-full w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={coverUrl}
        alt=""
        onError={() => setBrokenCover(coverUrl)}
        className="h-full w-full object-cover"
      />
      <Avatar
        src={avatarUrl}
        name={name}
        size="xs"
        className="absolute right-1 bottom-1 border-surface bg-surface"
      />
    </div>
  )
}

/**
 * The 2×2 photo collage the "All new" / "All rides" tiles carry. Repeats what it
 * has when it has fewer than four, and falls back to the flat placeholder the
 * design's own empty frame draws.
 */
export function FilterCollage({ images }: { images: string[] }) {
  if (images.length === 0) return <span className="block h-full w-full bg-border" />

  return (
    <span className="grid h-full w-full grid-cols-2 grid-rows-2">
      {Array.from({ length: 4 }, (_, i) => {
        const src = images[i % images.length]
        return src ? (
          // Signed URLs rotate hourly, so next/image would miss its cache every
          // render and proxy a private bucket for nothing. Same as Avatar.
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span key={i} className="block h-full w-full bg-border" />
        )
      })}
    </span>
  )
}
