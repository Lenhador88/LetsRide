'use client'

import { ChevronDownIcon } from '@/components/icons/generated'
import { cn } from '@/lib/utils'
import type { RideAttendance } from '@/types'

/**
 * The rider's own answer, on the ride's first content line — and the only route
 * back to the RSVP bar once answering has collapsed it (PD-404).
 *
 * Product owner, 2026-09-06: answering the RSVP replaces the bar rather than
 * stacking a floating action on top of it, and a chip on the title line carries
 * the answer from then on. Tapping it brings the bar back.
 *
 * ## It is a CONTROL, and everything below follows from that
 *
 * `RideCard`'s `AttendancePill` is the same fact rendered as a **badge**, and
 * this deliberately does not reuse it: that one is a `<span>` inside a `<Link>`
 * to the ride, ~20px tall, and reusing it here would produce a control a gloved
 * rider cannot hit and a screen reader announces as text.
 *
 * - **44×44 minimum hit target**, which is the glove floor. The *painted* chip
 *   stays at the pill's visual weight; the target is grown around it with
 *   padding and a negative margin, so the row's height does not change to
 *   accommodate a control that only some riders see.
 * - **A visible affordance** — the chevron — because once the bar is gone this
 *   chip is the only way to change an answer, and a coloured pill that happens
 *   to be tappable is not discoverable. A stale headcount on a ride cancelled
 *   for rain is what getting this wrong costs.
 * - **`aria-expanded`**, because the tap toggles the bar below rather than
 *   navigating. The label says what the answer *is* and the state says what the
 *   tap will do; announcing only "Going" would make the control's purpose
 *   invisible to anyone not looking at the chevron.
 *
 * ## The organizer and the past ride never get one, and that is upstream
 *
 * `resolveRideDetailActions` returns `statusChip: null` whenever the RSVP
 * question does not apply to the viewer — the organizer, whose departure `103`
 * refuses and whom `withOrganizer` renders `going` whatever is stored (PD-391),
 * and any past ride, where changing the answer would silently edit history. So
 * this component never has to ask: a chip it is asked to draw is one whose tap
 * does something.
 *
 * ## There is no `Not going` chip, and it is not an oversight
 *
 * `setRideAttendance` **deletes** the `ride_members` row for `No`, so a rider
 * who declined is byte-for-byte identical to one who never answered. Drawing
 * them a chip would need a real `no` status — a migration and a change to
 * `private.is_ride_crew` (`034`, and now `041`/`108`) — which the owner
 * declined knowingly. `AttendancePill` returns `null` for the same input for
 * the same reason.
 *
 * The two fills are `AttendancePill`'s, deliberately: `bg-accent` for a
 * committed *Going* and `bg-maybe` for the softer answer, so the same fact
 * reads the same on the list and on the detail. Both carry `text-white`, which
 * is the pairing the pill already ships.
 */
export function RideStatusChip({
  attendance,
  open,
  onToggle,
}: {
  /**
   * The stored answer. Never `null` at the call site — the page draws nothing
   * when `resolveRideDetailActions` returns no chip — but typed as the domain
   * type and guarded, so a caller that loses that gate renders nothing rather
   * than an unlabelled pill.
   */
  attendance: RideAttendance
  /** Whether the RSVP bar is currently reopened by this chip. */
  open: boolean
  onToggle: () => void
}) {
  if (!attendance) return null

  const going = attendance === 'going'

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      // The name a screen reader reads, since the visible text is one word and
      // the ride it belongs to is established by the heading rather than by
      // this control. "Change" rather than "Edit": it reopens a three-way
      // question, it does not open a form.
      aria-label={`You answered ${going ? 'Going' : 'Maybe'}. Change your answer`}
      className={cn(
        // The 44×44 floor, taken as padding around the painted pill and pulled
        // back out of the row with the negative margin, so a row that also
        // holds the club name keeps its own height.
        'group -my-3 -mr-2 inline-flex min-h-11 shrink-0 items-center py-3 pr-2 pl-1'
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full py-[3px] pr-1.5 pl-2.5 text-xs font-semibold text-white',
          going ? 'bg-accent' : 'bg-maybe'
        )}
      >
        {going ? 'Going' : 'Maybe'}
        {/* Rotates rather than swapping to an up-chevron: one icon, and the
            direction of travel reads as the bar sliding in from below. */}
        <ChevronDownIcon
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </span>
    </button>
  )
}
