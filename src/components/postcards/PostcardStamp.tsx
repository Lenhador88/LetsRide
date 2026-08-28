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
 * Two halves, and the second is the one that changes what the strip is *for*.
 * The perforated frame comes from `stamp-edge` in `globals.css`, which carries
 * the mask mechanics. The byline underneath is what turns a wall of anonymous
 * squares into a record of who was on the ride — the thing a Journal is, and the
 * thing `ClubPostcardCarousel`'s header calls out as the accepted cost of a tile
 * ("the byline, caption, likes and comments that `PostcardCard` drew in place
 * are not readable on a tile"). Half of that cost is now bought back.
 *
 * ## The name goes under the stamp, not on it
 *
 * The alternative — a scrim pill over the photo, the way the town and date
 * already sit on `PostcardCard` — was the other option put to the owner and is
 * not the one chosen. It is also the weaker one here: those pills sit on a
 * 334×200 photo, where a pill is a tenth of the height; on a 116px square the
 * same pill with a 24px avatar in it covers a third of the picture, which is the
 * whole content of the tile.
 *
 * ## Two callers, and the second is why this is a component
 *
 * `RideJournal` and `ClubPostcardCarousel` both draw it — the Journal first,
 * the club strip a merge later once the product owner saw what two gestures on
 * the same photos cost (*"lets do A. Same standard."*, 2026-08-27).
 *
 * That is the whole argument for the frame living in a `@utility` and the tile
 * in a component rather than as a class list copied twice. Anything drawing a
 * postcard as a tile should reach for this; a third caller should not need a
 * third decision about what a stamp looks like.
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
 * **No frame exists for it.** Checked offline against the committed snapshot:
 * there is no stamp component in Figma at all, and `v2 / Component / Postcard`'s
 * only provenance row is `User name · in · Club name`. Assembled from a measured
 * icon at a measured type scale and logged in docs/FIGMA-FIDELITY-TODO.md rather
 * than invented and called measured.
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
   * would say nothing. Only `ClubPostcardCarousel` has a mix to distinguish.
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

  const photo = (
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
      {postcard.image_url ? (
        // A signed URL that expires hourly — see `PostcardCard`'s note on why
        // next/image is the wrong tool for one.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={postcard.image_url}
          alt=""
          className="aspect-square w-full bg-track object-cover"
          loading="lazy"
          draggable={false}
        />
      ) : (
        // A URL that failed to sign, not a postcard without a photo. `bg-track`
        // rather than `bg-surface`, for the reason `RideJournalEmpty` records:
        // the surface here is already cream, so white reads as a card floating
        // above the strip instead of a slot in it.
        <span className="flex aspect-square w-full items-center justify-center bg-track text-muted">
          <ImageIcon className="h-6 w-6 opacity-60" aria-hidden="true" />
        </span>
      )}
    </span>
  )

  const byline = (
    <span className={cn('mt-1.5 flex items-center gap-1', STAMP_WIDTH)}>
      <Avatar src={postcard.author?.avatar_url} name={username} size="xs" className="h-5 w-5" />
      <span className="truncate text-2xs font-semibold text-foreground">{username}</span>
      {/* ## Why the marker sits at the END OF THE BYLINE ROW
          
          **Not a corner badge on the photo.** `stamp-edge` is a MASK and it
          bites exactly the corners a badge wants, and the shadow is a
          `filter: drop-shadow` chosen so it follows that notched silhouette —
          so anything painted into a corner is either clipped by the mask or
          sits outside the shadow and reads as detached.
          
          **Not a third row.** `STAMP_TILE_WIDTH` plus `aspect-square` size the
          neighbouring tiles on two different strips against this tile's height,
          so a row added here shifts the Journal as well as the club strip.
          
          `shrink-0` after a truncating username, so the glyph survives a long
          name rather than being the thing that disappears — the provenance is
          the whole point of drawing it. */}
      {fromRide && (
        <BikeIcon className="h-3 w-3 shrink-0 text-muted" aria-hidden="true" />
      )}
    </span>
  )

  const content = (
    <>
      {photo}
      {byline}
    </>
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
