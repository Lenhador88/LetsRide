'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChatBubbleIcon, OptionsIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { ClubWaveButton } from '@/components/clubs/ClubWaveButton'
import type { ClubWaveState } from '@/lib/data/club-waves'
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
 *
 * ## The `join` row is the one that is not just a link — `092`, PD-356
 *
 * `tasks.md` §0.6 asks whether the measured 44×326 `Event` row has room for a
 * wave control before adding one — it does not, on its own: avatar 28 +
 * sentence 242 + `Time Since` 16 already fills it with nothing to spare, and
 * there is no second frame drawing a wave, a count and an overflow trigger
 * here. This composition is therefore "ours", the way `ClubThreadRow` and
 * `CreateThreadForm` already are for the same reason (no v2 frame), rather
 * than measured — logged here so a reader does not mistake it for the frame's
 * own layout. The sentence is left to truncate under the extra controls
 * instead, which this row did not do before.
 *
 * A wave control and a "Say welcome" trigger cannot nest inside the row's own
 * `<a href>` — a button inside an anchor is invalid HTML and would fire both
 * the tap AND the navigation — so a `join` entry is the one row that wraps
 * only its avatar and sentence in a `Link`, with the time, the wave control
 * and the overflow trigger as its siblings rather than its children. Every
 * other kind stays the whole row is one `<Link>` (or `<div>` with no href).
 *
 * **Both the wave control and "Say welcome" are absent — not disabled — on a
 * rider's own join row.** `092`'s WITH CHECK refuses a self-wave, and
 * welcoming yourself expresses nothing either; drawing either affordance
 * there would let a rider discover the refusal by tapping it rather than by
 * its absence (`club-timeline-engagement`'s "the affordance SHALL be absent
 * from their own join row"). `viewerId` is the one thing this component reads
 * for no other reason.
 */
export function ClubTimelineEventRow({
  event,
  clubId,
  viewerId,
  wave,
}: {
  event: ClubTimelineEvent
  /** Needed only by the `join` branch, to build "Say welcome"'s link — every
   *  other kind ignores it. */
  clubId: string
  /** The signed-in rider's own id, or `undefined` while `getCurrentProfile`
   *  is still resolving. `undefined` renders as "not self" rather than
   *  hiding the affordance on every OTHER row while this is in flight; the
   *  one case that can be briefly wrong is the rider's own row for the
   *  instant before their profile resolves, and a tap in that window is
   *  refused by the database exactly as `OptimisticToggle`'s rollback
   *  already handles for any other refused write. */
  viewerId?: string
  /** Only meaningful for `kind === 'join'`. `state` inside is `undefined`
   *  while the batched wave read has not resolved — see `ClubWaveButton`. */
  wave?: {
    state: ClubWaveState | undefined
    onWave: () => Promise<{ error: string | null }>
    onUnwave: () => Promise<{ error: string | null }>
  }
}) {
  const parts = describe(event)

  const identity = (
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
    </>
  )

  const time = (
    <span className="shrink-0 text-xs font-normal text-muted">
      {/* Elapsed time, so no zone at all — see `formatRelativeTime`. The
          frame's `Time Since` reads `4d` / `1w`, which is what that helper
          already produces. */}
      {formatRelativeTime(event.at)}
    </span>
  )

  const rowClassName = 'flex min-h-[44px] w-full items-center gap-3 px-3 py-2'

  if (event.kind === 'join') {
    const isSelf = !!viewerId && event.member.user_id === viewerId

    return (
      <div className={rowClassName}>
        <Link
          // `parts.href` is always set for a `join` entry — see `describe`
          // below — but the type is shared across every kind, so the
          // fallback recomputes the identical route rather than asserting
          // past the type.
          href={parts.href ?? routes.profile(event.member.user_id)}
          // One label for the identity half only, now that the row holds more
          // than one control — the wave button and "Say welcome" carry their
          // own accessible names rather than being folded into this one.
          aria-label={parts.sentence}
          className="flex min-w-0 flex-1 items-center gap-3 transition-colors active:opacity-70"
        >
          {identity}
        </Link>

        {time}

        {!isSelf && wave && (
          <ClubWaveButton state={wave.state} onWave={wave.onWave} onUnwave={wave.onUnwave} />
        )}

        {!isSelf && (
          <JoinOverflow clubId={clubId} username={event.member.profile.username} />
        )}
      </div>
    )
  }

  // The club's founding goes nowhere — there is no screen for it, and a link
  // that returns to the screen you are on is worse than plain text.
  if (!parts.href) {
    return (
      <div className={`${rowClassName} text-left transition-colors active:bg-border`}>
        {identity}
        {time}
      </div>
    )
  }

  return (
    <Link
      href={parts.href}
      // The row is one label for assistive tech — the avatar is decorative.
      // **No unread state here**: threads and replies are the only events with
      // anything to catch up on, and both draw `ClubTimelineThreadRow` instead,
      // which carries the mark and says so in words.
      aria-label={parts.sentence}
      className={`${rowClassName} text-left transition-colors active:bg-border`}
    >
      {identity}
      {time}
    </Link>
  )
}

/**
 * "Say welcome" — the join row's one action beside the wave (`092`, PD-356,
 * `design.md` §D3). A menu with exactly one row rather than a bare icon
 * button, on `tasks.md` §6.8's own wording — "on the join row's overflow" —
 * and because a second bare glyph beside the wave control would be
 * indistinguishable from it at this size with no menu to say otherwise.
 *
 * Opens `CreateThreadForm` pre-filled with `Welcome, <username>` and nothing
 * else pre-decided; the rider edits or discards it like any other draft, and
 * nothing is written until they submit (`092`'s spec: "SHALL create no
 * schema", "The composer is pre-filled and fully editable"). There is no
 * link back from the thread to this row — see `design.md` §D3's "What it
 * does not do".
 */
function JoinOverflow({ clubId, username }: { clubId: string; username: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Options for ${username}’s arrival`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-5 w-5" />
      </button>

      <ContextMenu
        open={open}
        onClose={() => setOpen(false)}
        label={`Options for ${username}’s arrival`}
      >
        <ContextMenuItem
          href={routes.newClubThread(clubId, `Welcome, ${username}`)}
          icon={<ChatBubbleIcon className="h-6 w-6" />}
          onClick={() => setOpen(false)}
        >
          Say welcome
        </ContextMenuItem>
      </ContextMenu>
    </>
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

    // No wave on this row (`092`, PD-356) — it is about the CLUB, not a
    // person, and a wave is addressed to somebody. `ClubTimelineEventRow`'s
    // caller never supplies a `wave` prop for this kind, so there is nothing
    // to check here; noted for the same reason the other three absences are
    // noted at their own sites (`ClubTimelineRideCard`, `ClubTimeline`'s
    // `postcard` branch, `ClubTimelineThreadRow`'s `wave` prop doc).
    case 'club-created':
      return {
        sentence: event.founder ? `${event.founder} created the club.` : 'The club was created.',
        href: null,
        avatar: null,
      }

    // Three kinds draw their own shape and never reach this row: a postcard is
    // a `PostcardCard`, a ride is a `RideCard` under a label, and a thread —
    // created or replied to — is a `ClubTimelineThreadRow`. `groupClubTimeline`
    // routes all three away, so these arms are unreachable; they are typed
    // rather than thrown so the exhaustiveness above stays a compile-time check
    // and a sixth event kind is still an error here.
    case 'postcard':
    case 'ride':
    case 'thread':
    case 'reply':
      return { sentence: '', href: null, avatar: null }
  }
}
