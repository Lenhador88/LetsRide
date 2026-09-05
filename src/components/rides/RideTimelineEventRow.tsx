'use client'

import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { routes } from '@/lib/routes'
import { formatRelativeTime } from '@/lib/utils'
import type { RideTimelineEvent } from '@/lib/data/ride-timeline'

/**
 * One **announcement** on a ride's timeline — a rider arriving, or the ride
 * itself being planned.
 *
 * The club's `ClubTimelineEventRow` measured from `Private club - Timeline`
 * (`2043:10604`) → `Events` → `Event`: a 44px `Grey/10` row, a 28px avatar,
 * the sentence at `Poppins/14/Regular` `Grey/100`, a `Time Since` at
 * `Poppins/12/Regular` `Grey/80`. **This reuses that geometry deliberately
 * rather than measuring a ride frame of its own** — the product owner asked
 * for *"similar layout and characteristics to the club details"*, and there is
 * no v2 frame drawing announcements on a ride at all (`Ride - Journal
 * (Postcards/Timeline)`, `2226:4865`, draws postcards and nothing else). Two
 * screens meant to read the same, drawn by two components: what keeps them in
 * step is that both are this shape, so a change to the row here should be made
 * there too.
 *
 * **It is a separate component rather than a shared one, and the reason is the
 * event union.** `ClubTimelineEventRow` switches exhaustively over
 * `ClubTimelineEvent` — five kinds, three of them routed elsewhere — and its
 * whole value is that a sixth kind is a compile error. A component taking
 * either union would have to lose that, which is the one property worth
 * keeping: PD-395 and PD-394 both add a kind to THIS union, and each must fail
 * to compile here until its copy is written.
 *
 * **A postcard is not one of these.** `groupRideTimeline` routes it to
 * `PostcardCard`, exactly as the club does — compressing a photo into a 44px
 * row would throw the whole design away.
 *
 * **No wave and no introduction door here**, unlike the club's join row. Both
 * are `092`/`097` club machinery (`club_join_waves`, the introduction thread),
 * neither has a ride-side table, and inventing one is a product question
 * rather than a layout one.
 *
 * `id={event.key}` — every row carries `mergeRideTimeline`'s own key as its DOM
 * id, matching the club's rows. Nothing navigates away and back yet, so nothing
 * reads it today; it costs nothing and it is what a return anchor would need.
 */
export function RideTimelineEventRow({ event }: { event: RideTimelineEvent }) {
  const parts = describe(event)

  const identity = (
    <>
      {parts.avatar ? (
        <Avatar
          src={parts.avatar.avatarUrl}
          name={parts.avatar.name}
          size="sm"
          // 28px, the club row's — between `sm` (32) and `xs` (24), so the size
          // comes from the class rather than from a sixth entry in `sizes` that
          // only these two rows would ever use.
          className="h-7 w-7 shrink-0 text-2xs"
        />
      ) : null}

      <span className="min-w-0 flex-1 text-sm font-normal text-foreground">{parts.sentence}</span>
    </>
  )

  const time = (
    <span className="shrink-0 text-xs font-normal text-muted">
      {/* Elapsed time, so no zone at all — see `formatRelativeTime`. This is
          the one stamp on this screen that `rides.timezone` does not reach: it
          measures the distance between two instants, which is the same
          everywhere. */}
      {formatRelativeTime(event.at)}
    </span>
  )

  const rowClassName = 'flex min-h-[44px] w-full items-center gap-3 px-3 py-2'

  // The ride's founding goes nowhere — the rider is already on the ride's own
  // screen, and a link that returns you to where you are is worse than plain
  // text. A join goes to the rider.
  if (!parts.href) {
    return (
      <div id={event.key} className={rowClassName}>
        {identity}
        {time}
      </div>
    )
  }

  return (
    <Link id={event.key} href={parts.href} className={`${rowClassName} transition-colors active:bg-border`}>
      {identity}
      {time}
    </Link>
  )
}

/**
 * The sentence, the face and the destination for each kind of event.
 *
 * One exhaustive `switch` rather than a component per kind, so a third
 * announcement kind is a type error here rather than a row that renders blank
 * — `ClubTimelineEventRow`'s and `notificationCopy`'s shape.
 *
 * **Declarative, subject first, full stop** — the voice the club frame's own
 * three sentences set (*"Ron Wilson joined the club."*).
 *
 * **A join's subject never falls back, and the founding's does.** The
 * `profiles` SELECT policy hides a rider still mid-onboarding, so an embed can
 * resolve to `null`; a join's entire content IS the name, so `getRideJoins`
 * drops it at the read instead. The ride was planned whether or not we can
 * name who by, and that entry is the floor of the whole stream — dropping it
 * would leave the timeline with no end.
 */
function describe(event: RideTimelineEvent): {
  sentence: string
  href: string | null
  avatar: { name: string; avatarUrl: string | null } | null
} {
  switch (event.kind) {
    case 'join': {
      const rider = event.member.profile
      return {
        // **`going` and `maybe` read the same, and that is on purpose.**
        // `joined_at` records arrival, not the current answer, and a rider who
        // says maybe today and yes tomorrow does not arrive twice — so a
        // sentence naming the status would be a claim about the present made
        // from a past timestamp. The crew rail one section up is where the
        // current answer lives.
        sentence: `${rider.username} joined the ride.`,
        href: routes.profile(rider.id),
        avatar: { name: rider.username, avatarUrl: rider.avatar_url },
      }
    }

    case 'ride-planned':
      return {
        sentence: event.organizer ? `${event.organizer} planned this ride.` : 'The ride was planned.',
        href: null,
        avatar: null,
      }

    // A postcard draws its own card and never reaches this row —
    // `groupRideTimeline` routes it away. Typed rather than thrown so the
    // exhaustiveness above stays a compile-time check and a third event kind is
    // still an error here.
    case 'postcard':
      return { sentence: '', href: null, avatar: null }
  }
}
