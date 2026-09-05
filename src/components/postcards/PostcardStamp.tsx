'use client'

import Link from 'next/link'
import { BikeIcon, ImageIcon } from '@/components/icons/generated'
import { usePostcardViewer } from '@/components/postcards/viewerContext'
import { Avatar } from '@/components/ui/Avatar'
import { routes } from '@/lib/routes'
import { cn, formatPostcardDate } from '@/lib/utils'
import type { Postcard } from '@/types'

/** The tile's outer width. The photo is this minus the 6px frame either side. */
const STAMP_WIDTH = 'w-32'

/**
 * A postcard as a **postage stamp** — product owner, 2026-08-27: *"Ride journal
 * should list images as stamps + add user avatar and name."*
 *
 * Three parts, and only the first is decoration. The perforated frame comes
 * from `stamp-edge` in `globals.css`, which carries the mask mechanics. The
 * byline is what turns a wall of anonymous squares into a record of who was on
 * the ride — the thing a Journal is, and the thing the club's postcard strip
 * header calls out as the accepted cost of a tile ("the byline, caption, likes
 * and comments that `PostcardCard` drew in place are not readable on a tile").
 * Half of that cost is bought back. The postmark is what makes the first two
 * read as one object rather than as a photo with a caption under it.
 *
 * ## The byline is PRINTED ON the stamp — inside the frame, under the photo
 *
 * Product owner, 2026-08-29: *"the stamps, can we make them look a bit more
 * motorcyclyy and add the poster avatar and name into them"* (PD-350). The
 * operative word is *into*: the byline already existed, as a row **below** the
 * perforation, so the frame contained a bare photo and the name read as a
 * caption belonging to the strip.
 *
 * **Three placements, and the middle one is what shipped first.** A scrim pill
 * *over the photo* — the way the town and date sit on `PostcardCard` — was
 * refused and still is: those pills sit on a 334×200 photo where a pill is a
 * tenth of the height, and on a 116px square the same pill with a 24px avatar
 * in it covers a third of the picture, which is the whole content of the tile.
 * A row *under the frame* was the first answer and cost the metaphor. Printing
 * it *on the paper below the photo* takes neither cost: the photo stays whole,
 * and the name is on the stamp.
 *
 * **The tile's total height does not move**, which is why this is a one-file
 * change. The 6px gap the row used to sit under becomes the paper it prints on:
 * 6 + 116 + 6 + 20 + 6 either way. That matters because `STAMP_TILE_WIDTH`
 * sizes the neighbouring `Add` and `Nothing yet` tiles on TWO strips, and a
 * height change here shifts both.
 *
 * ## The postmark is a WHEEL, and deliberately not a bike
 *
 * `086` (PD-328) already spends `BikeIcon` on the ride marker at the end of the
 * byline, where it carries a meaning — *this photo reached the club's strip
 * through one of its rides*. A second bike on the same tile meaning something
 * else is worse than no motif at all, so the cancellation is a wheel: two rings,
 * eight spokes and a hub. It is also the only mark here that says *franked*,
 * which is the difference between a stamp and a photo with a notched border.
 *
 * ## The ride marker names no ride, and cannot
 *
 * `fromRide` (`086`, PD-328) draws a small `BikeIcon` after the username. It
 * says the photo reached this strip through one of the club's rides and never
 * WHICH — `062`'s column comment records that there is no postcard -> ride read
 * and that a badge naming one "needs its own accessor", and `086` deliberately
 * does not build that accessor. So the tile carries a boolean, not an identity,
 * and there is no navigation from a stamp to its ride.
 *
 * ## Two callers, and the second is why this is a component
 *
 * `RideJournal` draws it — and `PostcardCard` carries the same marker since
 * the club timeline replaced the club's strip (2026-08-31) —
 * the club strip a merge later once the product owner saw what two gestures on
 * the same photos cost (*"lets do A. Same standard."*, 2026-08-27).
 *
 * That is the whole argument for the frame living in a `@utility` and the tile
 * in a component rather than as a class list copied twice. Anything drawing a
 * postcard as a tile should reach for this; a third caller should not need a
 * third decision about what a stamp looks like.
 *
 * **No frame exists for any of it.** Checked offline against the committed
 * snapshot: there is no stamp component in Figma at all, and
 * `v2 / Component / Postcard`'s only provenance row is
 * `User name · in · Club name`. Assembled from a measured icon at a measured
 * type scale, with the postmark drawn here from circles and lines, and logged
 * in docs/FIGMA-FIDELITY-TODO.md rather than invented and called measured.
 */
export function PostcardStamp({
  postcard,
  fromRide = false,
  className,
}: {
  postcard: Postcard
  /**
   * Draw the ride glyph — this photo reached the strip through the club's RIDE
   * rather than because it was posted to the club (`086`, PD-328).
   *
   * **Defaults to false, and `RideJournal` never passes it.** Every stamp there
   * is from that ride by construction, so a marker would be on every tile and
   * would say nothing. Only a CLUB surface has a mix to distinguish, and
   * since the club timeline that surface is `PostcardCard` rather than this.
   */
  fromRide?: boolean
  className?: string
}) {
  const openPostcard = usePostcardViewer()
  const username = postcard.author?.username ?? 'Rider'
  const provenance = fromRide ? ' — from a ride' : ''
  // Folded into the existing label rather than added as a second labelled
  // element: the glyph is decoration inside a control that already has a name,
  // and a second one would make a screen reader announce the tile twice.
  const label = postcard.caption?.trim()
    ? `${username}: ${postcard.caption.trim()}${provenance}`
    : `Postcard from ${username}, ${formatPostcardDate(postcard.created_at)}${provenance}`

  const photo = postcard.image_url ? (
    <span className="relative block">
      {/* A signed URL that expires hourly — see `PostcardCard`'s note on why
          next/image is the wrong tool for one. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={postcard.image_url}
        alt=""
        className="aspect-square w-full bg-track object-cover"
        loading="lazy"
        draggable={false}
      />
      <StampPostmark />
    </span>
  ) : (
    // A URL that failed to sign, not a postcard without a photo. `bg-track`
    // rather than `bg-surface`, for the reason the deleted `RideJournalEmpty`
    // recorded and this keeps: the surface here is already cream, so white
    // reads as a card floating above the strip instead of a slot in it.
    //
    // No postmark: a cancellation over an empty slot reads as a broken glyph
    // rather than as ink, and there is nothing here to frank.
    <span className="flex aspect-square w-full items-center justify-center bg-track text-muted">
      <ImageIcon className="h-6 w-6 opacity-60" aria-hidden="true" />
    </span>
  )

  const byline = (
    <span className="mt-1.5 flex h-5 items-center gap-1">
      <Avatar src={postcard.author?.avatar_url} name={username} size="xs" className="h-5 w-5" />
      <span className="truncate text-2xs font-semibold text-foreground">{username}</span>
      {/* ## Why the marker sits at the END OF THE BYLINE ROW

          **Not a corner badge on the photo.** `stamp-edge` is a MASK and it
          bites exactly the corners a badge wants, and the shadow is a
          `filter: drop-shadow` chosen so it follows that notched silhouette —
          so anything painted into a corner is either clipped by the mask or
          sits outside the shadow and reads as detached. The postmark survives
          there only because it is drawn INSIDE the photo rather than over the
          frame's edge.

          **Not a third row.** `STAMP_TILE_WIDTH` plus `aspect-square` size the
          neighbouring tiles on two different strips against this tile's height,
          so a row added here shifts the Journal as well as the club strip.

          `shrink-0` after a truncating username, so the glyph survives a long
          name rather than being the thing that disappears — the provenance is
          the whole point of drawing it. */}
      {fromRide && <BikeIcon className="h-3 w-3 shrink-0 text-muted" aria-hidden="true" />}
    </span>
  )

  const content = (
    <span
      className={cn(
        'stamp-edge block shrink-0',
        STAMP_WIDTH,
        // The shadow follows the notched silhouette rather than a rectangle,
        // which is what `filter` buys over `box-shadow` on a masked element —
        // `box-shadow` is painted against the border box and would draw the
        // corners the mask just bit out.
        '[filter:drop-shadow(0_2px_4px_#00000014)]'
      )}
    >
      {photo}
      {byline}
    </span>
  )

  // No provider — a `PostcardStamp` rendered outside `(app)`, which today means
  // a test. The anchor is the honest fallback rather than a dead tile; see
  // `PostcardViewer`'s header.
  if (!openPostcard)
    return (
      <Link
        href={routes.postcard(postcard.id)}
        aria-label={label}
        className={cn('flex shrink-0 flex-col', STAMP_WIDTH, className)}
      >
        {content}
      </Link>
    )

  return (
    <button
      type="button"
      onClick={() => openPostcard(postcard.id)}
      aria-label={label}
      className={cn(
        'flex shrink-0 flex-col text-left',
        STAMP_WIDTH,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      {content}
    </button>
  )
}

/**
 * The cancellation — a wheel inked over the photo's top corner (PD-350).
 *
 * **Drawn here rather than added to the icon set.** `generated.tsx` is
 * generated from the Figma export and is never hand-edited; this is ornament
 * belonging to one component, not a glyph the library owes anyone. It is
 * circles and lines authored in this file, so there is no artwork provenance
 * question of the kind §Design System's fourth rule is about.
 *
 * **White ink with a dark halo, not black ink.** A postmark's real colour is
 * black and it is unreadable over the half of a rider's photos that are dark
 * tarmac and shadow; white alone disappears over the other half — sky, snow, a
 * white fairing. The `drop-shadow` is what makes one colour work on both, and
 * it is a filter rather than a stroke so it follows the spokes instead of
 * boxing them.
 *
 * **Two shadows, and the tight one is the load-bearing half.** A single soft
 * shadow renders as a halo rather than an edge over a bright photo, which is
 * what a first pass shipped: checked against a dark, a bright and a mid-tone
 * stand-in, the spokes read as a smudge on the bright one. `0 0 0.5px` at 70%
 * draws the edge; the softer second only lifts the mark off the picture.
 *
 * **`rotate-[-14deg]` is the whole difference between ink and UI.** Axis-aligned
 * it reads as a badge the tile is offering to be tapped; off-axis it reads as
 * something pressed onto the paper by hand, which is what a franking mark is.
 *
 * `aria-hidden` throughout: the tile already has a name, and this says nothing
 * a rider could act on.
 */
function StampPostmark() {
  return (
    <svg
      viewBox="0 0 40 40"
      className="pointer-events-none absolute right-1.5 top-1.5 h-9 w-9 rotate-[-14deg] text-white/95 [filter:drop-shadow(0_0_0.5px_#000000b3)_drop-shadow(0_1px_2px_#00000047)]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="18" strokeWidth="1.6" />
      <circle cx="20" cy="20" r="13.5" strokeWidth="1" />
      {/* Eight spokes, drawn from the hub out to just inside the inner ring.
          Generated rather than written out so the count is one number to
          change — and so a spoke cannot silently be a degree off its
          neighbours, which at this size reads as a smudge rather than as a
          wheel. */}
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4
        const sin = Math.sin(angle)
        const cos = Math.cos(angle)
        return (
          <line
            key={i}
            x1={(20 + 4.5 * sin).toFixed(2)}
            y1={(20 - 4.5 * cos).toFixed(2)}
            x2={(20 + 12.2 * sin).toFixed(2)}
            y2={(20 - 12.2 * cos).toFixed(2)}
            strokeWidth="1.3"
          />
        )
      })}
      <circle cx="20" cy="20" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * The stamp's outer width, for the tiles that sit **beside** one and have to
 * match its box — the `Add` tile and the "Nothing yet" tile on both strips.
 *
 * Exported rather than written out at those four sites because the coupling is
 * silent otherwise: a stamp is `w-32` with a 6px frame, so its photo block is
 * exactly `aspect-square w-32`, and changing `STAMP_WIDTH` would move every
 * stamp while leaving the neighbours at the old width on both screens — with
 * `tsc`, ESLint and every test green, since the mismatch is two string literals
 * that no longer agree.
 *
 * Tailwind still finds the class: `STAMP_WIDTH` above is a literal in this
 * file, which is what its scanner reads, and the call sites interpolate the
 * binding rather than composing a new class name.
 */
export const STAMP_TILE_WIDTH = STAMP_WIDTH
