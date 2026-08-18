'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListUser } from '@/components/ui/ListUser'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub, getClubMembers } from '@/lib/data/clubs'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'

/**
 * `Private club - Members` (`2059:6545`) — reached only from the merged club
 * detail's Members section (`See all`, or its rail's own `See all`), which is
 * why `ClubDetailHeader`'s back button returns there rather than to `/clubs`.
 *
 * The owner carries the brand ring and a trailing label, which is the same
 * `is Host=True` variant the ride crew uses for its organizer — one component,
 * two rosters. `admin` gets a label and no ring: the role exists in `001`'s
 * CHECK and nothing has ever written it, so drawing it as visually equal to the
 * owner would assert a hierarchy the app does not have.
 *
 * **No remove-member control**, though the v1 Create club frame draws one
 * against a `(Pending)` invite. Removing someone else needs a DELETE policy
 * `001` does not grant — `club_members` allows a rider to delete only their own
 * row — so the button would be a control that always fails. That is a migration
 * plus an admin model, not a button.
 *
 * `joinClub` and `leaveClub` invalidate the whole `clubs` prefix, which reaches
 * `clubs.detail(id)` and `clubs.members(id)` together — so the count line and
 * the roster below it cannot drift apart, even though they come from two reads.
 */
export default function ClubMembersPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubMembersScreen />
    </Suspense>
  )
}

function ClubMembersScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))
  // Enabled only once the club has come back. `getClubMembers` raises on a
  // malformed uuid, so eagerly issued it would answer `/clubs/junk/members`
  // with an error screen where the merged club page answered 404 — see that
  // page for the full reasoning.
  const members = useQuery(club.data ? queryKeys.clubs.members(id) : null, () =>
    getClubMembers(id)
  )

  if (club.data === null) notFound()

  // Above both gates: back comes from the URL via `current`, so it stays
  // usable while the club is arriving and when it has failed.
  const header = <ClubDetailHeader clubId={id} club={club.data} current="members" />

  const gate = combineQueries(club, members)

  return (
    <>
      {header}

      {/* No `.pt-header-sub-extra`: the sub-page switcher that made this
          header the 120px variant is deleted (the club detail merge), so the
          shell's own 96px is the whole of it and this owns its own 16px gap
          under that, matching the ride sub-pages' own `pt-4`. */}
      <div className="pt-4">
        {gate.error ? (
          <ErrorState onRetry={gate.refetch} />
        ) : // Both, not just the club: the count line reads from the club and
        // the rows from the roster, and drawing "12 members" over an empty
        // list for a tick is a worse artifact than one more moment of
        // placeholder.
        !club.data || !members.data ? (
          <SkeletonList rows={5} />
        ) : (
          <div className="px-4 motion-safe:animate-fade-in">
            {/* Counts the array below it, never `club.members_count`. The rail
                on the club detail counts this same list under this same key,
                and the aggregate genuinely differs from it: `getClubMembers`
                caps at `CLUB_ROSTER_LIMIT` and drops rows whose profile the
                policies hide, while `members_count:club_members(count)` does
                neither. Two numbers one tap apart, from two derivations, is the
                trap PD-254 named for the ride crew. */}
            <p className="mb-2 text-sm font-medium text-muted">
              {members.data.length} {members.data.length === 1 ? 'member' : 'members'}
            </p>

            <ul className="overflow-hidden rounded-lg bg-surface">
              {members.data.map((member) => (
                <li key={member.user_id}>
                  <ListUser
                    name={member.profile?.username ?? 'Rider'}
                    avatarUrl={member.profile?.avatar_url}
                    isHost={member.role === 'owner'}
                    note={
                      member.role === 'member'
                        ? undefined
                        : member.role === 'owner'
                          ? 'Owner'
                          : 'Admin'
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}
