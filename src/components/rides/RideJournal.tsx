import Link from 'next/link'
import { ImageIcon, PlusIcon } from '@/components/icons/generated'

/**
 * The ride Journal's **empty state, and only that** (PD-254).
 *
 * Nothing in the app writes `postcards.ride_id` yet — `041` added the column and
 * the grant, `tag-postcards-to-rides` group 4 is the half that fills it — so
 * every ride's journal is empty and this is the whole of what can be drawn
 * truthfully today. The photo tiles, the sequence line and the journal route are
 * PD-257's.
 *
 * **The section is drawn rather than hidden**, which is the decision worth
 * recording: a section nobody has seen is a feature nobody knows exists, and
 * empty is the state every ride starts in. So it says what it is waiting for.
 *
 * **The SECTION is shown to anyone who can see the ride; only `Add` is crew
 * only** (PD-282). This used to be gated whole, on the argument that a
 * non-member "has no `Add` to be offered and no photos to be shown" — the first
 * half is true and the second was not.
 * `public.ride_journal_postcard_ids` (`062`) gates on `private.can_read_ride`
 * plus `011`'s postcard SELECT qual and **says nothing about crew membership**,
 * so the database has always been willing to show a ride's photos to anyone who
 * can open the ride. The gate was the UI inventing a rule the policy does not
 * have, on the screen a rider reads while deciding whether to join.
 *
 * `Add` stays crew-only for the opposite reason — it is the database's rule
 * rather than the UI's. Tagging requires `private.is_ride_crew` (`041`), so the
 * tile would be a promise the insert refuses.
 *
 * ## `Add` posts a postcard; it does not yet tag one to this ride
 *
 * The composer takes no ride, so a photo added from here lands in the rider's
 * feed and not in this journal — which is why the tile below is honest about
 * being empty rather than promising the photo will appear. PD-256 is the write
 * half that closes it, and it is blocked on this screen existing to put the
 * `Add` on. Recorded here rather than inferred later: this link is complete only
 * once the composer carries the ride.
 */
export function RideJournalEmpty({ canAdd }: { canAdd: boolean }) {
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
          href="/postcards/new"
          className="flex aspect-square min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-track text-muted transition-colors active:bg-border"
        >
          <PlusIcon className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs font-semibold">Add</span>
        </Link>
      )}
    </div>
  )
}
