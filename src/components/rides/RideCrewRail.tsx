'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState } from '@/components/ui/ErrorState'
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
 * lands. A **failed** read keeps the rail a rail: the header stays a disclosure
 * button and the panel it opens carries `ErrorState`'s retry and the `See all`
 * link. The plan page's own `ErrorState` still owns the separate case where the
 * *ride* could not be read.
 *
 * **The failed state used to REPLACE the whole rail with a `<Link>` to the crew
 * page** — same box, same height, same chevron — so a failed read was
 * indistinguishable from a working rail except that tapping it navigated
 * instead of expanding. `ClubMemberRail` shipped the identical fallback and
 * PD-382 is the report of it on the club screen; this is the same defect one
 * screen over, fixed with it rather than left to be reported again.
 *
 * **Data outranks a stale error.** A refetch that fails leaves the previous
 * crew in the cache (`queryClient.ts` writes `error` without clearing `data`),
 * and `isStale` already treats an error as always-stale, so foregrounding or
 * reconnecting retries it. Drawing the crew we hold beats blanking it over a
 * failure the next sweep is about to clear.
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

  // A read that failed with nothing cached. Not `roster.error` alone: an error
  // over data we already hold is a failed *refetch*, and the crew in hand is
  // the better answer — see the header.
  const failed = !roster.data && !!roster.error

  if (!roster.data && !failed) {
    return (
      <div className="mx-4 flex min-h-[46px] items-center gap-3 rounded-lg border border-border px-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    )
  }

  const crew = roster.data ? withOrganizer(roster.data, organizerId, organizer) : null
  const summary = crew ? crewRailSummary(crew, isUpcoming) : null
  const label = summary ? summary.label : 'Who’s riding'

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
        {summary && (
          <span aria-hidden="true" className="flex shrink-0 -space-x-2">
            {summary.shown.map((member) => (
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
                  //
                  // **`is_host`, never `i === 0`.** This read the index until
                  // PD-429, which was correct only while `withOrganizer` prepended
                  // the host to `going` unconditionally. Now that they lead
                  // whichever section their own RSVP names, `going[0]` is an
                  // ordinary crew member the moment the organizer answers Maybe —
                  // and the ring would knight them as the host on a screen the
                  // organizer is looking at. Every other host-marking site in this
                  // repo reads the flag; this one no longer infers it from order.
                  member.is_host &&
                    'relative z-10 ring-2 ring-accent ring-offset-2 ring-offset-background'
                )}
              />
            ))}
            {summary.overflow > 0 && (
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-track text-2xs font-semibold text-foreground">
                +{summary.overflow}
              </span>
            )}
          </span>
        )}

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
          {crew ? (
            <>
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
                  {/* **The same two host props the `going` rows carry**, and they
                      became reachable here with PD-429: the organizer can answer
                      Maybe, so `withOrganizer` can place the host in this section.
                      Without them the rail drops the `Ride host` label for a rider
                      the crew page one tap away still labels — two adjacent screens
                      disagreeing about who is hosting the ride. */}
                  {crew.maybe.map((member) => (
                    <ListUser
                      key={member.user_id}
                      name={member.profile?.username ?? 'Rider'}
                      avatarUrl={member.profile?.avatar_url}
                      isHost={member.is_host}
                      note={member.is_host ? 'Ride host' : undefined}
                    />
                  ))}
                </>
              )}
            </>
          ) : (
            <ErrorState
              message="We could not load the crew. It is usually temporary — try again in a moment."
              onRetry={roster.refetch}
            />
          )}

          {/* The open state shows what `getRideCrew` returned, which is capped
              at `RIDE_CREW_LIMIT`. The crew page reads the same capped list, so
              this is not "the rest of them" — it is the roster with its own
              header and its own room, and it stays the specified destination.
              It stays under a FAILED read too: the page it points at is the
              escape hatch the old link fallback was, and it is the one thing
              that read has not made useless. */}
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
 *
 * **`0 going` with no avatars became reachable with PD-429, and it is the right
 * answer rather than a state to special-case.** A host riding alone who answers
 * Maybe empties `going`, and the rail says so; the panel below still lists them
 * under *May be going* with their host label. Adding the maybes to this number
 * to avoid the zero is exactly the arithmetic that got the count removed from
 * this screen the first time — a rail reading `1 going` over a roster that says
 * nobody is. The test suite pins the degenerate state so a later tidy-up has to
 * argue with an assertion rather than with a comment.
 */
export function crewRailSummary(crew: RideCrew, isUpcoming: boolean) {
  const shown = crew.going.slice(0, RIDE_AVATAR_LIMIT)
  return {
    shown,
    overflow: crew.going.length - shown.length,
    label: `${crew.going.length} ${isUpcoming ? 'going' : 'rode'}`,
  }
}
