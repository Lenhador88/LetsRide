'use client'

import Link from 'next/link'
import { ImageIcon, PlusIcon } from '@/components/icons/generated'
import { Skeleton } from '@/components/ui/Skeleton'
import { getRideJournal } from '@/lib/data/postcards'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { formatPostcardDate } from '@/lib/utils'

/**
 * The ride Journal section on the ride plan (PD-254, PD-256) — a horizontal
 * strip of square tiles, the ride-side twin of `ClubPostcardCarousel`. That
 * component's own header records it was modelled on this one's carousel look
 * while `postcards.ride_id` had no writer and every ride's Journal was
 * therefore always empty; now that PD-256 closes the write half, the two are
 * close to literal twins — same tile size, same `bg-track` recessed fill,
 * same tap-through to the postcard's own thread. They stay two components
 * rather than one shared one because their empty states differ (crew-gated
 * `Add` here, membership-gated messaging there) and because a club's feed is
 * never actually empty, so `ClubPostcardCarousel` never had to draw a
 * placeholder tile at all until this file's decision to draw rather than hide
 * gave it one to copy.
 *
 * **Reads its own data — `queryKeys.postcards.journal(rideId)` through
 * `getRideJournal`** — the same shape `RideCrewRail` reads `rides.crew(id)`,
 * rather than the ride plan page fetching it and passing rows down. One fewer
 * thing the page's own gate has to know about, and the same reasoning: this
 * section's own read failing must not take the whole plan down.
 *
 * **The SECTION is shown to anyone who can see the ride; only `Add` is crew
 * only** (PD-282). This used to be gated whole, on the argument that a
 * non-member "has no `Add` to be offered and no photos to be shown" — the
 * first half is true and the second was not.
 * `public.ride_journal_postcard_ids` (`062`) gates on `private.can_read_ride`
 * plus `011`'s postcard SELECT qual and **says nothing about crew
 * membership**, so the database has always been willing to show a ride's
 * photos to anyone who can open the ride. `Add` stays crew-only for the
 * opposite reason — it is the database's rule rather than the UI's: tagging
 * requires `private.is_ride_crew` (`041`), so the tile would be a promise the
 * insert refuses.
 *
 * ## The three read states, and why a failure is not one of the other two
 *
 * `undefined` draws two skeleton tiles at the loaded layout's own size, so
 * nothing jumps when the read lands.
 *
 * A **failed** read draws its own tile and must. Falling back to
 * `RideJournalEmpty` was the first draft's answer, on the stated precedent of
 * `RideCrewRail` — and that precedent says the opposite: `RideCrewRail` falls
 * back to a **link** reading "See who's riding", which asserts nothing about
 * content and hands the rider a route to the real answer. `RideJournalEmpty`
 * draws the words *"Nothing yet"*, which is a claim about the world, and to
 * crew it adds *"Prep shots count"* and an `Add` tile — so a rider whose read
 * failed would be told this ride has no photos and invited to upload one on
 * that premise. Degrading to navigation and degrading to a false fact are
 * different things.
 *
 * This section has no standalone route to fall back to yet (that is PD-257's),
 * so the honest degradation is a tile that makes no count claim and offers the
 * retry — task 4.9's "error with retry", at preview scale rather than the
 * seven-state screen PD-257 owns.
 */
export function RideJournal({ rideId, canAdd }: { rideId: string; canAdd: boolean }) {
  const journal = useQuery(queryKeys.postcards.journal(rideId), () => getRideJournal(rideId))

  // Checked ahead of `!journal.data`, which a failed read leaves `undefined`
  // forever — without this branch the skeleton below would never resolve to
  // anything for a rider whose read keeps failing.
  if (journal.error) return <RideJournalUnavailable onRetry={journal.refetch} />

  if (!journal.data) {
    return (
      <div className="flex gap-2 px-4">
        <Skeleton className="aspect-square min-w-0 flex-1 rounded-lg" />
        <Skeleton className="aspect-square min-w-0 flex-1 rounded-lg" />
      </div>
    )
  }

  if (journal.data.length === 0) return <RideJournalEmpty canAdd={canAdd} rideId={rideId} />

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {journal.data.map((postcard) => (
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

      {canAdd && (
        <Link
          href={routes.newPostcardInRide(rideId)}
          className="flex aspect-square w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-track text-muted transition-colors active:bg-border"
        >
          <PlusIcon className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs font-semibold">Add</span>
        </Link>
      )}
    </div>
  )
}

/**
 * What the strip draws when its own read failed — never `RideJournalEmpty`, for
 * the reason the component header gives: "Nothing yet" is a claim about the
 * ride, and this state knows nothing about the ride.
 *
 * One tile rather than two, and no `Add`: offering the crew tile here would
 * invite an upload on the same false premise, and the postcard would land
 * correctly but against a Journal the rider still cannot see.
 */
function RideJournalUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex gap-2 px-4">
      <div className="flex aspect-square min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-border px-3 text-center">
        <ImageIcon className="h-6 w-6 text-muted opacity-60" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground">Photos didn&apos;t load</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-2xs font-semibold text-accent underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

/**
 * The ride Journal's empty state (PD-254) — drawn rather than hidden, which is
 * the decision worth recording: a section nobody has seen is a feature nobody
 * knows exists, and empty is the state every ride starts in. So it says what
 * it is waiting for.
 *
 * **`Add` now tags the postcard it creates to this ride** (PD-256) —
 * `routes.newPostcardInRide`, not a bare `/postcards/new`. Until this change
 * the tile was honest about being empty because the composer took no ride and
 * a photo added from here could never appear here; that gap is what this
 * closes, so the tile's promise is now one the write path keeps.
 */
export function RideJournalEmpty({ canAdd, rideId }: { canAdd: boolean; rideId: string }) {
  return (
    <div className="flex gap-2 px-4">
      {/* `min-w-0` on both, and it is the difference between a matched pair and
          two different squares. A flex item defaults to `min-width: auto`, so
          `flex-1` (`1 1 0%`) cannot shrink it below its *min-content* width —
          and "Prep shots count" is wider than "Add". Measured on a 390px
          viewport before this: 187×187 beside 163×163, from two elements
          carrying identical classes. The tiles are squares by `aspect-square`,
          so the width error is a height error too. */}
      <div className="flex aspect-square min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-border px-3 text-center">
        <ImageIcon className="h-6 w-6 text-muted opacity-60" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground">Nothing yet</span>
        {/* The second line is the one thing that differs by viewer, and it has
            to: `Prep shots count` is an instruction, and instructing a rider
            who has no `Add` beside them to take photos is the empty promise
            this section was gated to avoid. Said the other way round, it is
            still a reason to look again later. */}
        <span className="text-2xs text-muted">
          {canAdd ? 'Prep shots count' : 'Photos from this ride land here'}
        </span>
      </div>

      {/* `bg-track`, not `bg-surface`. The mock fills this tile with its
          `--device-fill`, which is a *subtle tint against the surface it sits
          on* — and on that mock the surface is a white phone body, so the tint
          is cream. This page's surface is already cream, so translating the
          token by name gives white, which at 175px square is the brightest
          thing on the screen and reads as a card rather than a slot. `bg-track`
          is the same recessed fill the map panel directly above already uses,
          which is what the mock's relationship actually looks like here. */}
      {canAdd && (
        <Link
          href={routes.newPostcardInRide(rideId)}
          className="flex aspect-square min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-track text-muted transition-colors active:bg-border"
        >
          <PlusIcon className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs font-semibold">Add</span>
        </Link>
      )}
    </div>
  )
}
