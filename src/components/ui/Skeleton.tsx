import { cn } from '@/lib/utils'

/**
 * The loading treatments the render migration needs (design D7 / task 5.2),
 * plus `SkeletonFilterBar`, which PD-217 added for a different reason — see
 * its own note. The committed Figma snapshot has zero loading, error or
 * offline frames (design.md §Context constraint 3), so nothing here is
 * measured — geometry is copied from the real component each shape stands in
 * for (`PostcardCard`/`PostcardDeck`, `RideCard`/`ClubCard`, the ride/club
 * detail pages, `FilterBar`/`FilterTile`, `CreateRideForm`/`AuthScreen`), and
 * colour is `bg-foreground/10`, the same translucent fallback tint `Avatar`'s
 * initials circle already uses — no new token is introduced.
 *
 * **One treatment per screen *shape*, not per screen.** `SkeletonList` alone
 * stands in for the rides list, the clubs list, a member list and a search
 * result list; building a bespoke skeleton for each would be four guesses at
 * a design nobody has drawn, and D7 is explicit that the fix for "the design
 * has no answer" is fewer guesses, not more of them.
 *
 * They all live in this one file, matching `Card.tsx`'s precedent of a small
 * family of related exports sharing one file rather than one export per
 * file — they share the base `Skeleton` primitive and would otherwise
 * duplicate its import once each.
 *
 * **The skeleton itself does not fade in, and that is deliberate.** The fade
 * belongs to the content that replaces one of these — `globals.css`'s
 * `animate-fade-in`, applied at each screen's content slot. Putting it here
 * as well looks like symmetry and is a defect on the two screens that render
 * a skeleton at *two* positions either side of a gate: `/rides` and
 * `/postcards` each show one while the filter read is in flight and a second,
 * in the list or deck slot, while that read still is. Those are different
 * tree positions, so the second is a fresh mount — the rider watches the
 * skeleton fade in, blink out and fade in again, on exactly the boundary
 * PD-210 was merged to make seamless. A skeleton that simply appears has none
 * of that.
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
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  )
}

/**
 * Stands in for `PostcardDeck` — the home screen's card stack. Geometry from
 * `PostcardCard`: a 342-wide card filling its slot at `p-1`, the photo taking
 * whatever is left after an `xs` (24px) avatar row, a capped caption and the
 * four-item action row — all reasoned in that component's own doc comment
 * rather than re-measured here.
 */
export function SkeletonDeck() {
  return (
    <SkeletonRegion label="Loading postcards" className="relative flex h-full items-center justify-center px-6">
      {/* **The OUTER box tracks `PostcardDeck` exactly, and that is the part
          that has to**: this stands in the deck's own slot, so a mismatch there
          moves the card at the moment the feed arrives. Since PD-343 that means
          the slot's height rather than the design's 342/448 ratio.

          The rows below it match the shape rather than the content — the photo
          is the row that grows off the same 200px floor, the caption is fixed
          where the real one is 0–80px. Two placeholder lines cannot know how
          long a caption it is standing in for, so the photo/byline boundary
          still moves a little at the swap; the card does not. */}
      <div className="relative h-full max-h-[36rem] w-full max-w-[342px] overflow-hidden rounded-lg bg-surface p-1">
        <div className="flex h-full flex-col gap-2">
          <Skeleton className="w-full shrink-0 grow basis-[200px] rounded" />
          <div className="flex shrink-0 items-center gap-2 px-3">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-24 rounded" />
          </div>
          <div className="flex shrink-0 flex-col gap-2 px-3">
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
 * Stands in for `RideFilterBar`/`PostcardFilterBar` — and unlike the other
 * shapes here it exists to reserve height rather than to describe content.
 *
 * **Both list screens use it, and the second one is not an afterthought.**
 * `/rides` and `/postcards` each gate their bar and their content separately
 * (PD-210), so the bar arrives on its own read — and whatever sits below it
 * moves when it lands. That number is not chosen: `FilterBar` is `py-2` (16)
 * around a `FilterTile` column of `h-[68px]` image + `gap-1` (4) + the label's
 * `text-2xs` line box (16) = 88. **The label slot is a `h-4` box holding a
 * shorter bar** rather than a 10px bar on its own — reserving the drawn height
 * instead of the line height is what leaves a 6px jump behind.
 *
 * **How much of the 104 a rider sees is a property of the alignment below it,
 * not of this component.** `/rides` is a top-aligned list, so the whole 104
 * shows (PD-217). `/postcards` centres a card in the slot, so it moves by half
 * — 52 (PD-218). The second went unnoticed for a day because PD-217 asked
 * whether the card moved *within* its slot, which it does not, rather than
 * whether the slot itself resized. **The bar carries no `env()`**, so both
 * numbers hold on every device, unlike the frame heights either screen's own
 * doc quotes.
 *
 * Tile count is cosmetic: the bar is a horizontal scroller, so only its height
 * can move anything. The first two are circles because "Your rides" and "All
 * rides" are always present and always round; clubs are the rounded squares.
 *
 * **`aria-hidden`, not a `role="status"` region like the other four.** This one
 * describes nothing — it reserves height — and it draws *above* a shape that
 * already announces the load (`SkeletonList` on `/rides`, `SkeletonDeck` on
 * `/postcards`). A region here would add a second announcement beside that
 * one, which is what the base `Skeleton`'s own `aria-hidden` note exists to
 * avoid. It does **not** fix the separate double-announce those two screens
 * already have across their `<Suspense>` fallback and their gate — PD-220.
 *
 * `shrink-0` is copied from the real `FilterBar` and is load-bearing: the
 * parent is `flex flex-col`, so without it the reservation compresses under
 * pressure and the height it promises is a lie.
 */
export function SkeletonFilterBar({ tiles = 4 }: { tiles?: number }) {
  return (
    <div
      aria-hidden
      className="flex shrink-0 gap-0 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="flex w-20 shrink-0 flex-col items-center gap-1">
          <div className="flex h-[68px] w-[68px] items-center justify-center">
            <Skeleton
              className={
                i < 2 ? 'h-16 w-16 rounded-full' : 'h-[60px] w-[60px] rounded-lg'
              }
            />
          </div>
          <span className="flex h-4 items-center">
            <Skeleton className="h-2.5 w-12 rounded" />
          </span>
        </div>
      ))}
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
