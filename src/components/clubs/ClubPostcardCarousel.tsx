import Link from 'next/link'
import { ImageIcon, PlusIcon } from '@/components/icons/generated'
import { PostcardStamp, STAMP_TILE_WIDTH } from '@/components/postcards/PostcardStamp'
import { routes } from '@/lib/routes'
import type { Postcard } from '@/types'

/**
 * The `Postcards` section on the merged club detail — a horizontal strip of
 * **stamps**, one per postcard in the club's feed. Product owner, 2026-08-18:
 * *"like that carousel"*, pointing at the ride detail's `RideJournal`, and the
 * two have tracked each other since.
 *
 * **They draw the same tile as of 2026-08-27**: both render `PostcardStamp` —
 * a perforated frame with the author's avatar and username under it — so what
 * differs between the two components is only their empty state, crew-gated
 * `Add` there and membership-gated messaging here.
 *
 * **Tapping one opens the postcard as a popup rather than navigating**, because
 * that behaviour lives in `PostcardStamp` and arrives with it. Same as the
 * Journal, same as the home deck.
 *
 * **The trade the product owner accepted in 2026-08-18 is now half bought
 * back**: the caption, likes and comments `PostcardCard` drew in place are
 * still not readable on a tile, but the byline is, and the popup puts the rest
 * one tap away without leaving the club.
 *
 * `min-w-0` is not needed here the way `RideJournalEmpty` needed it, and the
 * reason is that **nothing in this row is `flex-1`** — every child is sized by
 * `shrink-0` plus an explicit width, so no item is ever asked to shrink below
 * its min-content and the `min-width: auto` default cannot bite. That is also
 * why this strip does not reuse `RideJournalEmpty`'s `flex-1` trick at all: it
 * only works for exactly two tiles, and this one holds however many the club
 * has posted.
 *
 * `bg-track`, not `bg-surface`, on the `Add` tile — see `RideJournalEmpty`'s
 * identical note. This screen's surface is already cream, so a white fill here
 * would read as a card floating above the strip rather than a recessed slot in
 * it.
 *
 * `Add` opens the composer with **this club already chosen** as the audience
 * (PD-283, `routes.newPostcardInClub`) and returns here rather than to Home.
 * The `clubId` prop exists for that and for nothing else.
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
    // `items-start` and `pb-1.5` are the stamp's, not this component's own —
    // see `RideJournal`, which carries the reason for each: a stamp is its
    // 128px photo block plus a byline, the `Add` tile is the block alone, and
    // `overflow-x-auto` would clip the drop shadow off the bottom edge.
    <div className="flex items-start gap-2 overflow-x-auto px-4 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* First, not last (PD-318). Appended after the stamps it was invisible
          the moment the club had posted more than two: the strip scrolls, and
          nothing on the page said the tile was out there. The product owner hit
          exactly that on the rides strip beside this one and asked for both —
          *"Add ride, postcard, start a thread, should be in the beginning of
          the scroll"*. Unlike the ride strip's create tile this one did not
          have to shrink to earn the slot: it is already the same square as a
          stamp, and one stamp-width of head start still leaves two full stamps
          on a 390px screen. */}
      {isMember && (
        <Link
          href={routes.newPostcardInClub(clubId)}
          className={`flex aspect-square ${STAMP_TILE_WIDTH} shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-track text-muted transition-colors active:bg-border`}
        >
          <PlusIcon className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs font-semibold">Add</span>
        </Link>
      )}

      {/* The empty state draws rather than hides, and it draws the `Add` beside
          it — `RideJournal`'s recorded decision, which the first pass of this
          component dropped: "a section nobody has seen is a feature nobody
          knows exists, and empty is the state every ride starts in". A club
          starts there too, and that is exactly when the rider needs the way
          in. */}
      {postcards.length === 0 && (
        <div
          className={`flex aspect-square ${STAMP_TILE_WIDTH} shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-border px-3 text-center`}
        >
          <ImageIcon className="h-6 w-6 text-muted opacity-60" aria-hidden="true" />
          <span className="text-xs font-semibold text-foreground">Nothing yet</span>
        </div>
      )}

      {postcards.map((postcard) => (
        <PostcardStamp key={postcard.id} postcard={postcard} />
      ))}
    </div>
  )
}
