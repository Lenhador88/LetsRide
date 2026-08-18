import Link from 'next/link'
import { ImageIcon, PlusIcon } from '@/components/icons/generated'
import { routes } from '@/lib/routes'
import type { Postcard } from '@/types'

/**
 * The `Postcards` section on the merged club detail — a horizontal strip of
 * square tiles, replacing the stacked `PostcardCard` list this section drew
 * before the club detail merge. Product owner, 2026-08-18: *"like that
 * carousel"*, pointing at the ride detail's `RideJournal` — this is that
 * carousel's real-tile counterpart, since the club feed is never empty the
 * way a ride's journal always is today (nothing writes `postcards.ride_id`
 * yet; every club's feed is real rows from day one).
 *
 * **This is a deliberate trade the product owner accepted knowingly**: the
 * byline, caption, likes and comments that `PostcardCard` drew in place are
 * not readable on a tile. A rider taps through to the postcard's own thread
 * for those — `routes.postcard(id)`, the same destination the feed's cards
 * link to.
 *
 * `min-w-0` is not needed here the way `RideJournalEmpty` needed it —
 * `w-28 shrink-0` sizes every tile explicitly rather than splitting a flex
 * parent two ways, which is also why this strip does not reuse that
 * component's `flex-1` trick: it only works for exactly two tiles, and this
 * one holds however many the club has posted.
 *
 * `bg-track`, not `bg-surface`, on the `Add` tile and on a tile whose signed
 * URL failed to sign — see `RideJournalEmpty`'s identical note. This screen's
 * surface is already cream, so a white fill here would read as a card
 * floating above the strip rather than a recessed slot in it.
 *
 * ## `Add` posts a postcard; it does not tag it to this club
 *
 * `CreatePostcardForm`'s club picker is a controlled `<select>` seeded from
 * `useState('')` — the composer reads no query parameter naming a club — so a
 * photo added from here lands wherever the rider picks on the form, not
 * necessarily in this club's feed. Same gap `RideJournalEmpty` documents for
 * the ride side.
 */
export function ClubPostcardCarousel({ postcards }: { postcards: Postcard[] }) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {postcards.map((postcard) => (
        <Link
          key={postcard.id}
          href={routes.postcard(postcard.id)}
          className="aspect-square w-28 shrink-0 overflow-hidden rounded-lg bg-track"
        >
          {postcard.image_url ? (
            // A signed URL that expires hourly — see `PostcardCard`'s identical
            // note on why next/image is the wrong tool for it.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={postcard.image_url}
              alt={postcard.caption ?? ''}
              className="h-full w-full object-cover"
              loading="lazy"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted">
              <ImageIcon className="h-6 w-6 opacity-60" aria-hidden="true" />
            </div>
          )}
        </Link>
      ))}

      <Link
        href="/postcards/new"
        className="flex aspect-square w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-track text-muted transition-colors active:bg-border"
      >
        <PlusIcon className="h-6 w-6" aria-hidden="true" />
        <span className="text-xs font-semibold">Add</span>
      </Link>
    </div>
  )
}
