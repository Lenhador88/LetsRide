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
 * **Crew only** — its caller gates it on the same predicate as the chat row.
 * A rider who is not on the ride has no `Add` to be offered and no photos to be
 * shown, so the section would be an empty promise rather than an empty state.
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
export function RideJournalEmpty() {
  return (
    <div className="flex gap-2 px-4">
      <div className="flex flex-1 aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-border px-3 text-center">
        <ImageIcon className="h-6 w-6 text-muted opacity-60" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground">Nothing yet</span>
        <span className="text-2xs text-muted">Prep shots count</span>
      </div>

      <Link
        href="/postcards/new"
        className="flex flex-1 aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-surface text-muted transition-colors active:bg-border"
      >
        <PlusIcon className="h-6 w-6" aria-hidden="true" />
        <span className="text-xs font-semibold">Add</span>
      </Link>
    </div>
  )
}
