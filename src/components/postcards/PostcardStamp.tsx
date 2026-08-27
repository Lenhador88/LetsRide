'use client'

import Link from 'next/link'
import { ImageIcon } from '@/components/icons/generated'
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
 * ## Not `ClubPostcardCarousel`'s tile, yet
 *
 * That component draws the same square from the same `Postcard` and is
 * deliberately left alone: the owner asked for the Journal, and a stamp is a
 * postal metaphor that reads on a *ride's* photo record more obviously than on a
 * club feed. Adopting it there is a one-line change if that is wanted — the
 * shared piece is this file rather than a copied class list, which is why the
 * frame lives in a utility and the tile in a component.
 */
export function PostcardStamp({ postcard, className }: { postcard: Postcard; className?: string }) {
  const openPostcard = usePostcardViewer()
  const username = postcard.author?.username ?? 'Rider'
  const label = postcard.caption?.trim()
    ? `${username}: ${postcard.caption.trim()}`
    : `Postcard from ${username}, ${formatPostcardDate(postcard.created_at)}`

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

/** The tile width, for the states beside a stamp that have to match its box. */
export const STAMP_TILE_WIDTH = STAMP_WIDTH
