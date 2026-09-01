import { RideCard } from '@/components/rides/RideCard'
import { formatRelativeTime } from '@/lib/utils'
import type { RideListItem } from '@/types'

/**
 * A ride on the club timeline — the announcement as a label, the ride as the
 * card the rides list draws.
 *
 * Product owner, 2026-08-31: *"when someone creates a ride, maybe we could add
 * the ride overview (like in ride list screen), but still keep the label on top
 * 'pedro889 planned a ride'."* Both halves are load-bearing and they say
 * different things. The **label** is the event — who did it, and when it
 * happened, which is when the ride was *announced*. The **card** is the ride —
 * when it leaves, from where, and who is going. Collapsing them into one line
 * loses the ride; dropping the label turns a timeline into a list of rides with
 * no sense of when anything was decided.
 *
 * `showClub={false}`, which is the design's own rule rather than a choice here:
 * `RideCard`'s club chip is dropped on the club-filtered screen because every
 * ride there already belongs to the club naming it, and this is that screen.
 *
 * The composition — a muted label over a card — is ours, and the frame is
 * worth reading before assuming why. `Private club - Timeline` DOES draw a
 * ride-derived row in its stream, inside the `Grey/10` run: *"Pedro Abreu and
 * Julia Windfield went on a ride!"* — but that is a different event. It is
 * post-hoc, about a ride that HAPPENED, with its crew named; this is the
 * announcement, at `rides.created_at`, and nothing in the schema answers "who
 * went" for a past ride. So the card is ours because the frame has no
 * announcement to follow, not because the frame keeps rides out of its stream.
 * Logged in docs/FIGMA-FIDELITY-TODO.md.
 *
 * **No wave control, deliberately** (`092`, PD-356). An RSVP is already a
 * stronger signal than a wave and would sit beside it saying something
 * weaker — the ride event is the one entry on the timeline whose engagement
 * mechanism already exists (`RideCard`'s own attendance controls), so this
 * change adds nothing here.
 *
 * **`anchorKey` is the scroll target only — PD-366.** It is `mergeClubTimeline`'s
 * own key for this row (`ride:<uuid>`), set as this card's DOM `id` so a Back
 * from elsewhere on the timeline can scroll to it. `RideCard`'s own link still
 * goes to the plain ride detail screen: that screen's own Back is unconditional
 * (`RideHeader`'s `current === 'plan'`), not driven by this parameter, and nothing
 * here changes that.
 */
export function ClubTimelineRideCard({
  ride,
  at,
  anchorKey,
}: {
  ride: RideListItem
  at: string
  anchorKey: string
}) {
  const organizer = ride.organizer?.username

  return (
    <section id={anchorKey} className="flex flex-col gap-1.5">
      <p className="flex items-baseline gap-2 px-1 text-sm font-medium text-muted">
        <span className="min-w-0 flex-1 truncate">
          {/* The name falls back rather than the label vanishing: the `profiles`
              policy hides a rider mid-onboarding, and a ride they planned still
              happened. */}
          {organizer ? `${organizer} planned a ride` : 'A ride was planned'}
        </span>
        <span className="shrink-0 text-xs font-normal">
          {/* When it was ANNOUNCED. The card carries the departure, which is a
              different instant and often a very different date — see
              `RideListItem.created_at`. */}
          {formatRelativeTime(at)}
        </span>
      </p>

      <RideCard ride={ride} showClub={false} />
    </section>
  )
}
