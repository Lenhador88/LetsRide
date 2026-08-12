import { cn } from '@/lib/utils'

/**
 * The four loading treatments the render migration needs (design D7 /
 * task 5.2). The committed Figma snapshot has zero loading, error or offline
 * frames (design.md §Context constraint 3), so nothing here is measured —
 * geometry is copied from the real component each shape stands in for
 * (`PostcardCard`/`PostcardDeck`, `RideCard`/`ClubCard`, the ride/club detail
 * pages, `CreateRideForm`/`AuthScreen`), and colour is `bg-foreground/10`,
 * the same translucent fallback tint `Avatar`'s initials circle already
 * uses — no new token is introduced.
 *
 * **One treatment per screen *shape*, not per screen.** `SkeletonList` alone
 * stands in for the rides list, the clubs list, a member list and a search
 * result list; building a bespoke skeleton for each would be four guesses at
 * a design nobody has drawn, and D7 is explicit that the fix for "the design
 * has no answer" is fewer guesses, not more of them.
 *
 * All four live in this one file, matching `Card.tsx`'s precedent of a small
 * family of related exports sharing one file rather than one export per
 * file — they share the base `Skeleton` primitive and would otherwise
 * duplicate its import four times over.
 *
 * **`SkeletonRegion`'s root also carries `motion-safe:animate-fade-in`**
 * (`globals.css`), the other half of the fade the loaded content that
 * replaces each of these carries at its own call site. Defined once here so
 * every shape gets it rather than four screens re-adding it by hand.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    // `aria-hidden`: the loading state as a whole is announced once by the
    // `role="status"` region each shape below wraps itself in; a screen
    // reader does not need to hear "loading, loading, loading" once per bar.
    <div
      aria-hidden
      className={cn(
        // `prefers-reduced-motion` is a real accessibility requirement, not
        // a nicety — Tailwind's `motion-safe:` variant is what makes the
        // pulse conditional on it rather than something layered on top that
        // is easy to forget on the next skeleton someone adds.
        'motion-safe:animate-pulse rounded-md bg-foreground/10',
        className
      )}
    />
  )
}

function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    // Shared by all four shapes, so the region itself fades in once rather
    // than snapping to full opacity — the flash a sub-100ms fetch would
    // otherwise cause, since the skeleton would appear and disappear in the
    // same frame. `motion-safe:` for the same reason `animate-pulse` above
    // carries it: `prefers-reduced-motion` gets the skeleton with no motion
    // at all, not a softer version of it.
    <div role="status" aria-label={label} className={cn('motion-safe:animate-fade-in', className)}>
      {children}
    </div>
  )
}

/**
 * Stands in for `PostcardDeck` — the home screen's card stack. Geometry from
 * `PostcardCard`: the 342×448 slot at `p-1` with a `334/200` photo, an
 * `xs` (24px) avatar row, caption lines and the four-item action row, all
 * measured in that component's own doc comment rather than re-measured here.
 */
export function SkeletonDeck() {
  return (
    <SkeletonRegion label="Loading postcards" className="relative flex h-full items-center justify-center px-6">
      <div className="relative aspect-[342/448] w-full max-w-[342px] overflow-hidden rounded-lg bg-surface p-1">
        <div className="flex h-full flex-col gap-2">
          <Skeleton className="aspect-[334/200] w-full shrink-0 rounded" />
          <div className="flex shrink-0 items-center gap-2 px-3">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-24 rounded" />
          </div>
          <div className="flex flex-1 flex-col gap-2 px-3">
            <Skeleton className="h-3.5 w-full rounded" />
            <Skeleton className="h-3.5 w-4/5 rounded" />
          </div>
          <div className="flex shrink-0 items-center gap-3 px-3 pb-2">
            <Skeleton className="h-6 w-10 rounded-full" />
            <Skeleton className="h-6 w-10 rounded-full" />
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/**
 * Stands in for a `RideCard`/`ClubCard` row: an 80px media strip (`w-20
 * self-stretch`, both cards' measured width) beside a title bar, a subtitle
 * bar and a 28px (`h-7 w-7`) overlapping avatar pair — both cards' own
 * measured avatar size.
 */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonRegion label="Loading list" className="flex flex-col gap-2 px-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 rounded-lg bg-surface p-1 pr-4">
          <Skeleton className="w-20 shrink-0 self-stretch rounded" />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 py-3">
            <Skeleton className="h-4 w-3/5 rounded" />
            <Skeleton className="h-3 w-2/5 rounded" />
            <div className="flex -space-x-1">
              <Skeleton className="h-7 w-7 rounded-full border-2 border-surface" />
              <Skeleton className="h-7 w-7 rounded-full border-2 border-surface" />
            </div>
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

/**
 * Stands in for the ride/club detail pages' content column: a title bar, two
 * body lines, two 64px-tall icon rows (`h-16`, the ride detail's own measured
 * row height for its date/location rows, hairline included) and a 160px
 * block (`h-40`, the ride detail's measured map height).
 */
export function SkeletonDetail() {
  return (
    <SkeletonRegion label="Loading" className="flex flex-col gap-4 px-6 pt-4 pb-4">
      <Skeleton className="h-7 w-3/4 rounded" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full rounded" />
        <Skeleton className="h-3.5 w-5/6 rounded" />
      </div>
      <div className="flex flex-col">
        <DetailRowSkeleton />
        <DetailRowSkeleton />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
    </SkeletonRegion>
  )
}

function DetailRowSkeleton() {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-border">
      <Skeleton className="h-6 w-6 shrink-0 rounded" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-32 rounded" />
        <Skeleton className="h-3 w-20 rounded" />
      </div>
    </div>
  )
}

/**
 * Stands in for `CreateRideForm`/`AuthScreen`: `Input`'s own measured
 * `h-[72px]` for each field, and `Button`'s `lg` size (`h-14`) for the
 * submit control.
 */
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <SkeletonRegion label="Loading form" className="flex flex-col gap-4 px-6 pt-4">
      {Array.from({ length: fields }, (_, i) => (
        <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
      ))}
      <Skeleton className="h-14 w-full rounded-lg" />
    </SkeletonRegion>
  )
}
