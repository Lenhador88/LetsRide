'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { ListUser } from '@/components/ui/ListUser'
import { Skeleton } from '@/components/ui/Skeleton'
import { RIDE_AVATAR_LIMIT, getRideCrew, withOrganizer } from '@/lib/data/rides'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { PublicProfile, RideCrew } from '@/types'

/**
 * The crew rail on the ride plan — the avatars, the count, and the roster it
 * opens in place (PD-254).
 *
 * ## The count is only allowed here because of where it comes from
 *
 * A crew count sat on this screen once before and was **removed**: it counted
 * `maybe` RSVPs under a "going" label and disagreed with the roster one tap
 * away. That is the trap PD-254 names, and the defence is not care — it is that
 * this component reads `queryKeys.rides.crew(id)` through `getRideCrew`, the
 * same key and the same function `/rides/detail/crew` renders, and then counts
 * the *same array* that page draws under `Going`. Two screens cannot disagree
 * about a number neither of them derives.
 *
 * So: do not accept `riders_count` as a prop, do not add the maybes in, and do
 * not compute this from anything the crew page does not also read. The maybes
 * have their own group in the open state, exactly as they have their own
 * section on the crew page.
 *
 * ## Why the organizer arrives as two props rather than being read here
 *
 * `withOrganizer` is what puts the host at the head of `going` and marks them,
 * and it needs the ride. This component could read the ride itself — the key is
 * cached and the plan page has already asked for it — but then the rail would
 * carry its own copy of the "is there a ride at all" question, and the answer to
 * that decides `notFound()` on the page above. One screen, one authority.
 *
 * ## The three states, and the one that is not a spinner
 *
 * `undefined` draws the rail's shell with a skeleton in it, at the same height
 * the loaded rail has, so the sections under it do not jump when the roster
 * lands. A **failed** read does not take the screen down and does not offer a
 * retry: it falls back to the link this rail replaced. A rider who cannot see
 * who is coming can still get to the page that lists them, which is strictly
 * better than an error where a roster should be — and the plan page's own
 * `ErrorState` already owns the case where the *ride* could not be read.
 */
export function RideCrewRail({
  rideId,
  organizerId,
  organizer,
  isUpcoming,
}: {
  rideId: string
  organizerId: string
  organizer: PublicProfile | null
  /** Decides the tense of the count — `12 going` before, `12 rode` after. */
  isUpcoming: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const roster = useQuery(queryKeys.rides.crew(rideId), () => getRideCrew(rideId))

  if (roster.error) {
    return (
      <Link
        href={routes.rideCrew(rideId)}
        className="mx-4 flex min-h-[46px] items-center gap-3 rounded-lg border border-border px-3"
      >
        <span className="flex-1 text-sm font-semibold text-foreground">See who’s riding</span>
        <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
      </Link>
    )
  }

  if (!roster.data) {
    return (
      <div className="mx-4 flex min-h-[46px] items-center gap-3 rounded-lg border border-border px-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    )
  }

  const crew = withOrganizer(roster.data, organizerId, organizer)
  const { shown, overflow, label } = crewRailSummary(crew, isUpcoming)

  return (
    <div className="mx-4 rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        // Only while the panel exists. The panel is unmounted when closed (see
        // below), and an `aria-controls` pointing at no element is a dangling
        // IDREF — some screen readers announce nothing for it, which is worse
        // than the attribute being absent on a control whose `aria-expanded`
        // already says what it does.
        aria-controls={open ? panelId : undefined}
        className={cn(
          'flex min-h-[46px] w-full items-center gap-3 rounded-lg px-3 text-left transition-colors active:bg-border',
          open && 'rounded-b-none border-b border-border'
        )}
      >
        {/* Hidden from the accessibility tree, and that is the difference
            between a button called "12 going" and one called "pl mk tv jr rr
            +7 12 going". `Avatar` renders `alt={name}`, and these five sit
            INSIDE the control, so every one of them joins its computed name —
            on the one element whose announcement is the whole point of the
            rail. The names are not lost: the panel this opens lists them as
            rows, which is where a screen reader should meet them. */}
        <span aria-hidden="true" className="flex shrink-0 -space-x-2">
          {shown.map((member, i) => (
            <Avatar
              key={member.user_id}
              src={member.profile?.avatar_url}
              // A profile the viewer cannot read comes back null — blocked, or
              // a rider who never finished onboarding. The row still counts, so
              // it still draws, exactly as the crew page draws it.
              name={member.profile?.username ?? 'Rider'}
              size="xs"
              className={cn(
                'h-8 w-8 border-background text-2xs',
                // The host's ring is drawn outside the photo, so it has to sit
                // above the avatar overlapping it — `RideCard` does the same.
                i === 0 && 'relative z-10 ring-2 ring-accent ring-offset-2 ring-offset-background'
              )}
            />
          ))}
          {overflow > 0 && (
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-track text-2xs font-semibold text-foreground">
              +{overflow}
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{label}</span>

        {open ? (
          <ChevronDownIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        ) : (
          <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        )}
      </button>

      {/* Unmounted rather than hidden while closed: the roster is as long as the
          ride is popular, and a collapsed rail that still contains fifty rows
          hands every one of them to the accessibility tree and to ⌘F. */}
      {open && (
        <div id={panelId} className="pb-1">
          {crew.going.map((member) => (
            <ListUser
              key={member.user_id}
              name={member.profile?.username ?? 'Rider'}
              avatarUrl={member.profile?.avatar_url}
              isHost={member.is_host}
              note={member.is_host ? 'Ride host' : undefined}
            />
          ))}

          {crew.maybe.length > 0 && (
            <>
              <p className="px-4 pt-2 text-2xs font-semibold tracking-wider text-muted uppercase">
                May be going
              </p>
              {crew.maybe.map((member) => (
                <ListUser
                  key={member.user_id}
                  name={member.profile?.username ?? 'Rider'}
                  avatarUrl={member.profile?.avatar_url}
                />
              ))}
            </>
          )}

          {/* The open state shows what `getRideCrew` returned, which is capped
              at `RIDE_CREW_LIMIT`. The crew page reads the same capped list, so
              this is not "the rest of them" — it is the roster with its own
              header and its own room, and it stays the specified destination. */}
          <Link
            href={routes.rideCrew(rideId)}
            className="mt-1 block border-t border-border px-4 py-3 text-sm font-semibold text-accent"
          >
            See all
          </Link>
        </div>
      )}
    </div>
  )
}

/**
 * What the collapsed rail draws, as data — extracted so the count and the tense
 * can be asserted without a DOM (this repo renders components to static markup
 * at most; see `PostcardAction.test.tsx`).
 *
 * `going` only, and `going` is post-`withOrganizer`, so the host is inside the
 * number rather than beside it. See the component's header for why any other
 * derivation is a bug rather than a preference.
 */
export function crewRailSummary(crew: RideCrew, isUpcoming: boolean) {
  const shown = crew.going.slice(0, RIDE_AVATAR_LIMIT)
  return {
    shown,
    overflow: crew.going.length - shown.length,
    label: `${crew.going.length} ${isUpcoming ? 'going' : 'rode'}`,
  }
}
