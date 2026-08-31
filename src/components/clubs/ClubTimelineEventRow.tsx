import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { routes } from '@/lib/routes'
import { formatRelativeTime } from '@/lib/utils'
import type { ClubTimelineEvent } from '@/lib/data/club-timeline'

/**
 * One **event** on a club's timeline — a rider arriving, a ride planned, a
 * thread started, the club itself being founded.
 *
 * Measured from `Private club - Timeline` (`2043:10604`) → `Events` → `Event`:
 * a 44px `Grey/10` row, a 28px `v2 / Component / Avatar`, the sentence at
 * `Poppins/14/Regular` `Grey/100`, and a `Time Since` at `Poppins/12/Regular`
 * `Grey/80`. The frame's own three sentences are *"Ron Wilson joined the
 * club."*, *"Pedro Abreu created the club."* and *"Pedro Abreu and Julia
 * Windfield went on a ride!"* — declarative, full stop, subject first — and the
 * copy below keeps that voice for the two kinds the frame does not draw.
 *
 * **A postcard is not one of these.** The frame interleaves *full postcard
 * cards* between the event groups, so `ClubTimeline` renders `PostcardCard`
 * for those and this component never sees one. Compressing a photo into a
 * 44px row would have been the whole design's point thrown away.
 *
 * **The product owner calls these "announcements"** — *"announcements are a new
 * thing, that resembles a discussion, but mainly to highlight a new rider
 * joined the club, a new ride was created"* (2026-08-31). The word describes
 * this row, not a record: there is no announcements table and none is planned.
 * Every entry is derived from a row that already existed, with a timestamp its
 * author cannot forge — `048` makes `club_members.joined_at` server-owned and
 * `045` does the same for `rides.created_at`. An admin-composed announcement is
 * a separate product question and deliberately not this.
 *
 * The frame draws the ride event with **no avatar** (a two-line sentence naming
 * two riders) and the two others **with** one, so the slot is optional here
 * rather than always filled.
 */
export function ClubTimelineEventRow({ event }: { event: ClubTimelineEvent }) {
  const parts = describe(event)
  // Only a thread carries one; every other kind is a fact about the past with
  // nothing to catch up on.
  const unread = event.kind === 'thread' && event.unread

  const body = (
    <>
      {parts.avatar ? (
        <Avatar
          src={parts.avatar.avatarUrl}
          name={parts.avatar.name}
          size="sm"
          // 28px, the frame's — between `sm` (32) and `xs` (24), so the size
          // comes from the class rather than from a sixth entry in `sizes`
          // that only this row would ever use.
          className="h-7 w-7 shrink-0 text-2xs"
        />
      ) : null}

      <span className="min-w-0 flex-1 text-sm font-normal text-foreground">{parts.sentence}</span>

      {unread && <NotificationDot className="shrink-0" />}

      <span className="shrink-0 text-xs font-normal text-muted">
        {/* Elapsed time, so no zone at all — see `formatRelativeTime`. The
            frame's `Time Since` reads `4d` / `1w`, which is what that helper
            already produces. */}
        {formatRelativeTime(event.at)}
      </span>
    </>
  )

  const className =
    'flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left transition-colors active:bg-border'

  // The club's founding goes nowhere — there is no screen for it, and a link
  // that returns to the screen you are on is worse than plain text.
  if (!parts.href) {
    return <div className={className}>{body}</div>
  }

  return (
    <Link
      href={parts.href}
      // The row is one label for assistive tech: the avatar is decorative and
      // `NotificationDot` is `aria-hidden` by construction, so the unread state
      // has to be in words or it is invisible to everyone not looking at it.
      aria-label={unread ? `${parts.sentence}, unread messages` : parts.sentence}
      className={className}
    >
      {body}
    </Link>
  )
}

/**
 * The sentence, the face and the destination for each kind of event.
 *
 * One exhaustive `switch` rather than four components, so a fifth event kind is
 * a type error here rather than a row that renders blank — the same reason
 * `notificationCopy` is shaped this way.
 *
 * **Every actor name falls back rather than the entry vanishing, except a
 * join.** The `profiles` SELECT policy hides a row with a NULL username, so a
 * rider still mid-onboarding resolves to `null` on any embed; a ride or a
 * thread still happened and still draws, with its subject generalised. A join
 * is the one entry whose entire content *is* the rider's name, so
 * `getClubJoins` drops it at the read instead — "someone joined the club" is
 * not an event, it is a shrug.
 */
function describe(event: ClubTimelineEvent): {
  sentence: string
  href: string | null
  avatar: { name: string; avatarUrl: string | null } | null
} {
  switch (event.kind) {
    case 'join': {
      const rider = event.member.profile
      return {
        sentence: `${rider.username} joined the club.`,
        href: routes.profile(rider.id),
        avatar: { name: rider.username, avatarUrl: rider.avatar_url },
      }
    }

    case 'ride': {
      const organizer = event.ride.organizer?.username
      return {
        sentence: organizer
          ? `${organizer} planned a ride: ${event.ride.title}.`
          : `A ride was planned: ${event.ride.title}.`,
        href: routes.ride(event.ride.id),
        // No face, matching the frame's own ride event — a ride is the club's,
        // not one rider's, and the crew it belongs to is on the ride screen.
        avatar: null,
      }
    }

    case 'thread': {
      const author = event.thread.author?.username
      return {
        sentence: author
          ? `${author} started a thread: ${event.thread.title}.`
          : `A thread was started: ${event.thread.title}.`,
        href: routes.clubThread(event.thread.id),
        avatar: null,
      }
    }

    case 'club-created':
      return {
        sentence: event.founder ? `${event.founder} created the club.` : 'The club was created.',
        href: null,
        avatar: null,
      }

    // A postcard is a card, not a row — see this file's header. Unreachable
    // from `ClubTimeline`, and typed rather than thrown so the exhaustiveness
    // above stays a compile-time check.
    case 'postcard':
      return { sentence: '', href: null, avatar: null }
  }
}
