'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListUser } from '@/components/ui/ListUser'
import { Skeleton } from '@/components/ui/Skeleton'
import { CLUB_AVATAR_LIMIT, getClubMembers } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { ClubRosterMember } from '@/types'

/**
 * The member rail on the merged club detail — the avatars, the count, and the
 * roster it opens in place. The club-detail counterpart of `RideCrewRail`,
 * built to the same rule and for the same reason.
 *
 * ## The count is only allowed here because of where it comes from
 *
 * `RideCrewRail`'s own count was removed once for disagreeing with the
 * roster one tap away, and the merge is only allowed to bring a count back
 * onto a detail screen under the condition that removal set: this component
 * reads `queryKeys.clubs.members(id)` through `getClubMembers`, the same key
 * and the same function `/clubs/detail/members` renders, and counts the
 * *same array* that page draws. Two screens cannot disagree about a number
 * neither of them derives.
 *
 * So: do not accept `members_count` as a prop and do not compute this from
 * `ClubDetail.members_count` — that aggregate is read under `clubs.detail`,
 * a different cache entry that can be stale relative to this one for up to
 * the query's own window, and a rail that read it would reproduce exactly
 * the two-numbers-for-one-fact defect the crew rail was built to avoid.
 *
 * ## Owner first, unlike the members page it borrows its rows from
 *
 * `getClubMembers` orders by `joined_at`, which puts the owner first only
 * because they were the club's first member — true today, not guaranteed by
 * the query. The rail sorts locally so the host ring is always the lead
 * avatar, the same guarantee `withOrganizer` gives the ride crew. This is
 * display order only: it does not touch the count, and the roster page below
 * this rail is free to keep its own `joined_at` order.
 *
 * ## The three states, and the one that is not a spinner
 *
 * `undefined` draws the rail's shell with a skeleton in it, at the same
 * height the loaded rail has, so the sections under it do not jump when the
 * roster lands. A **failed** read keeps the rail a rail: the header stays a
 * disclosure button and the panel it opens carries `ErrorState`'s retry and
 * the `See all` link. The page's own `ErrorState` still owns the separate
 * case where the *club* could not be read.
 *
 * **The failed state used to REPLACE the whole rail with a `<Link>` to
 * `/clubs/detail/members`** — same box, same height, same chevron — so a
 * failed read was indistinguishable from a working rail except that tapping
 * it navigated instead of expanding. That is PD-382 word for word, and it
 * read as a design bug for five days because the source's happy path does
 * expand. A rail must never silently become a link: whatever the read did,
 * tapping the section opens it here.
 *
 * **Data outranks a stale error.** A refetch that fails leaves the previous
 * roster in the cache (`queryClient.ts` writes `error` without clearing
 * `data`), and `isStale` already treats an error as always-stale, so
 * foregrounding or reconnecting retries it. Drawing the roster we hold beats
 * blanking it over a failure the next sweep is about to clear.
 */
export function ClubMemberRail({ clubId }: { clubId: string }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const roster = useQuery(queryKeys.clubs.members(clubId), () => getClubMembers(clubId))

  // A read that failed with nothing cached. Not `roster.error` alone: an
  // error over data we already hold is a failed *refetch*, and the roster in
  // hand is the better answer — see the header.
  const failed = !roster.data && !!roster.error

  if (!roster.data && !failed) {
    return (
      <div className="mx-4 flex min-h-[46px] items-center gap-3 rounded-lg border border-border px-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    )
  }

  const summary = roster.data ? clubRailSummary(roster.data) : null
  const label = summary ? summary.label : 'Members'

  return (
    <div className="mx-4 rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        // Only while the panel exists — see `RideCrewRail`'s identical note on
        // why a dangling `aria-controls` is worse than none.
        aria-controls={open ? panelId : undefined}
        className={cn(
          'flex min-h-[46px] w-full items-center gap-3 rounded-lg px-3 text-left transition-colors active:bg-border',
          open && 'rounded-b-none border-b border-border'
        )}
      >
        {/* Hidden from the accessibility tree for the same reason the crew
            rail hides its stack: five avatars inside the control would each
            join its computed name, on the one element whose announcement is
            the whole point of the rail. The panel this opens lists them as
            rows, which is where a screen reader should meet them. */}
        {summary && (
          <span aria-hidden="true" className="flex shrink-0 -space-x-2">
            {summary.shown.map((member, i) => (
              <Avatar
                key={member.user_id}
                src={member.profile?.avatar_url}
                // A profile the viewer cannot read comes back null — blocked, or
                // a rider who never finished onboarding. The row still counts,
                // so it still draws, exactly as the members page draws it.
                name={member.profile?.username ?? 'Rider'}
                size="xs"
                className={cn(
                  'h-8 w-8 border-background text-2xs',
                  i === 0 &&
                    member.role === 'owner' &&
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

      {/* Unmounted rather than hidden while closed — see `RideCrewRail` for
          why a collapsed rail must not keep fifty rows in the accessibility
          tree and in ⌘F. */}
      {open && (
        <div id={panelId} className="pb-1">
          {summary ? (
            summary.ordered.map((member) => (
              <ListUser
                key={member.user_id}
                name={member.profile?.username ?? 'Rider'}
                avatarUrl={member.profile?.avatar_url}
                isHost={member.role === 'owner'}
                note={
                  member.role === 'member' ? undefined : member.role === 'owner' ? 'Owner' : 'Admin'
                }
              />
            ))
          ) : (
            <ErrorState
              message="We could not load the members. It is usually temporary — try again in a moment."
              onRetry={roster.refetch}
            />
          )}

          {/* The open state shows what `getClubMembers` returned, which is
              capped at `CLUB_ROSTER_LIMIT`. The members page reads the same
              capped list, so this is not "the rest of them" — it is the
              roster with its own header and its own room, and it stays the
              specified destination. It stays under a FAILED read too: the
              page it points at is the escape hatch the old link fallback
              was, and it is the one thing that read has not made useless. */}
          <Link
            href={routes.clubMembers(clubId)}
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
 * What the collapsed rail draws, as data — extracted so the ordering and the
 * count can be asserted without a DOM, the same reason `crewRailSummary` is
 * exported.
 *
 * `ordered` puts the owner first, stably — see the component's header for
 * why that is a display concern the query itself does not guarantee. `shown`
 * and `overflow` are read off `ordered`, so the avatar stack and the `+N`
 * bubble always describe the same list the panel goes on to render.
 */
export function clubRailSummary(members: ClubRosterMember[]) {
  const ordered = [...members].sort(
    (a, b) => Number(b.role === 'owner') - Number(a.role === 'owner')
  )
  const shown = ordered.slice(0, CLUB_AVATAR_LIMIT)
  return {
    ordered,
    shown,
    overflow: ordered.length - shown.length,
    label: `${ordered.length} ${ordered.length === 1 ? 'member' : 'members'}`,
  }
}
