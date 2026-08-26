import Link from 'next/link'
import { ImageIcon, PlusIcon } from '@/components/icons/generated'
import { routes } from '@/lib/routes'
import { formatPostcardDate } from '@/lib/utils'
import type { Postcard } from '@/types'

/**
 * The `Postcards` section on the merged club detail — a horizontal strip of
 * square tiles, replacing the stacked `PostcardCard` list this section drew
 * before the club detail merge. Product owner, 2026-08-18: *"like that
 * carousel"*, pointing at the ride detail's `RideJournal` — which drew only a
 * placeholder tile then, because nothing wrote `postcards.ride_id` and every
 * ride's Journal was therefore always empty. **PD-256 closed that**, so the two
 * are near-twins now and this is no longer the only one of the pair with real
 * rows in it. What still differs is the empty state, which a club feed reaches
 * far less often than a ride's Journal does on its first day.
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
export function ClubPostcardCarousel({
  postcards,
  isMember,
  clubId,
}: {
  postcards: Postcard[]
  /**
   * Decides both the `Add` tile and what an empty strip says. A non-member
   * looking at a public club reads an empty feed whatever the club has posted
   * — `009` scopes club postcards to members — so "nothing posted yet" would
   * be a claim this screen cannot make.
   */
  isMember: boolean
  /**
   * Only so `Add` can carry it (PD-283) — the composer opens with this club
   * already chosen as the audience and returns here rather than to Home. Not
   * used to read anything: the postcards arrive as a prop.
   */
  clubId: string
}) {
  if (postcards.length === 0 && !isMember)
    return (
      <p className="px-4 text-sm font-medium text-muted">
        Postcards in this club are for its members.
      </p>
    )

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* The empty state draws rather than hides, and it draws the `Add` beside
          it — `RideJournal`'s recorded decision, which the first pass of this
          component dropped: "a section nobody has seen is a feature nobody
          knows exists, and empty is the state every ride starts in". A club
          starts there too, and that is exactly when the rider needs the way
          in. */}
      {postcards.length === 0 && (
        <div className="flex aspect-square w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-border px-3 text-center">
          <ImageIcon className="h-6 w-6 text-muted opacity-60" aria-hidden="true" />
          <span className="text-xs font-semibold text-foreground">Nothing yet</span>
        </div>
      )}

      {postcards.map((postcard) => (
        <Link
          key={postcard.id}
          href={routes.postcard(postcard.id)}
          aria-label={
            postcard.caption?.trim() || `Postcard from ${formatPostcardDate(postcard.created_at)}`
          }
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

      {isMember && (
        <Link
          href={routes.newPostcardInClub(clubId)}
          className="flex aspect-square w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-track text-muted transition-colors active:bg-border"
        >
          <PlusIcon className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs font-semibold">Add</span>
        </Link>
      )}
    </div>
  )
}
