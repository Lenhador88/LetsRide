import Link from 'next/link'
import { routes } from '@/lib/routes'
import { cn, formatRideChipDate, formatRideTime } from '@/lib/utils'
import type { RideListItem } from '@/types'

/**
 * `v2 / Component / Collection / Ride` (`2059:5732`) — the 200×56 chip the
 * club detail's Upcoming rides section scrolls horizontally.
 *
 * Resolves a fidelity gap `docs/FIGMA-FIDELITY-TODO.md` had logged since
 * 2026-08-05 as a deliberate trade — "Upcoming rides render as list cards,
 * not the drawn chip … a second card component for one strip is the trade" —
 * by finally building the second component, now that the club detail merge
 * needs the strip to actually scroll rather than stack.
 *
 * **Near-black (`bg-foreground`), not `bg-surface`.** Measured off the frame
 * rather than decided here: this is the one card in the app whose *fill* is
 * the dark token, everywhere else being white or cream on it. The date block
 * is `Grey/5` — this app's own `bg-background` — so its day number reads in
 * `text-foreground` and its month in `text-muted`, both already tokens, drawn
 * on a different surface than every other use of them in this file. The time
 * and location lines are `text-white` / `text-background`: the frame's
 * `White/100` and `Grey/5` fills respectively, and `text-background` is a
 * genuine token match (`#F2ECE6`) rather than an invented pairing — see
 * `OfflineState` for the same `bg-foreground` + `text-white` combination
 * elsewhere in the app.
 *
 * **The time is a single instant, not the drawn `14:00 - 18:00` range.** Same
 * gap `formatRideTime` already documents: `rides` has no end-time column.
 * Logged again in docs/FIGMA-FIDELITY-TODO.md §Club detail rather than
 * repeated at every call site of the same formatter.
 *
 * Fixed at the frame's own 200px rather than flexing to its scroller, so a
 * long `meeting_point` truncates instead of stretching the chip past what the
 * design draws.
 *
 * ## A past ride inverts the chip (PD-319)
 *
 * The club strip carries both halves of `getRides` now — upcoming first, then
 * past — so a chip has to say which it is without a section header to sit
 * under, which is the only distinction the ride *list* has ever needed
 * (`/clubs/detail/rides` draws a `Past rides` header over its second list, and
 * `AttendancePill` swaps "Going" for "Went"). Neither travels into a single
 * scroller.
 *
 * **So the fill inverts rather than tinting**: `bg-track` with the dark text,
 * against the upcoming chip's `bg-foreground` with light text. That is a
 * luminance difference, so it survives the greyscale check the story asked for
 * — a hue change or an opacity drop would not, and an opacity drop would also
 * read as "disabled" on a chip that is still a working link. `bg-track` is the
 * same recessed cream the create tile beside it uses, which is what makes the
 * strip read as one row of tiles with the live ones standing out of it.
 *
 * **Not a prop.** `is_upcoming` is already on every `RideListItem`, computed
 * against `rideDayStartUtc` by the same read that sorts the two halves — so a
 * caller cannot pass one that disagrees with the list the chip came out of.
 */
export function RideChip({ ride }: { ride: RideListItem }) {
  const { day, month } = formatRideChipDate(ride.departure_at, ride.timezone)
  const past = !ride.is_upcoming

  return (
    <Link
      href={routes.ride(ride.id)}
      className={cn(
        'flex w-[200px] shrink-0 items-center gap-3 rounded-lg p-1',
        past ? 'bg-track' : 'bg-foreground'
      )}
    >
      {/* The date block keeps its own contrast against whichever fill it sits
          on: cream inside the dark chip, white inside the light one. Left at
          `bg-background` on a past chip it would be the same cream as the chip
          around it and stop reading as a block at all. */}
      <span
        className={cn(
          'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded',
          past ? 'bg-surface' : 'bg-background'
        )}
      >
        <span className="text-base leading-6 font-semibold text-foreground">{day}</span>
        <span className="text-xs leading-[18px] font-semibold text-muted">{month}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span
          className={cn(
            'truncate text-sm font-semibold',
            past ? 'text-foreground' : 'text-white'
          )}
        >
          {formatRideTime(ride.departure_at, ride.timezone)}
        </span>
        <span className={cn('truncate text-sm font-medium', past ? 'text-muted' : 'text-background')}>
          {ride.meeting_point}
        </span>
      </span>
    </Link>
  )
}
