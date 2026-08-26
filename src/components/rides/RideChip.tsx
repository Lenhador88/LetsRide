import Link from 'next/link'
import { routes } from '@/lib/routes'
import { formatRideChipDate, formatRideTime } from '@/lib/utils'
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
 */
export function RideChip({ ride }: { ride: RideListItem }) {
  const { day, month } = formatRideChipDate(ride.departure_at, ride.timezone)

  return (
    <Link
      href={routes.ride(ride.id)}
      className="flex w-[200px] shrink-0 items-center gap-3 rounded-lg bg-foreground p-1"
    >
      <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded bg-background">
        <span className="text-base leading-6 font-semibold text-foreground">{day}</span>
        <span className="text-xs leading-[18px] font-semibold text-muted">{month}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="truncate text-sm font-semibold text-white">
          {formatRideTime(ride.departure_at, ride.timezone)}
        </span>
        <span className="truncate text-sm font-medium text-background">{ride.meeting_point}</span>
      </span>
    </Link>
  )
}
