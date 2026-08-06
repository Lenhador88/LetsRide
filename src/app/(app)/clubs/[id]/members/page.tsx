'use client'

import { notFound, useParams } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListUser } from '@/components/ui/ListUser'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub, getClubMembers } from '@/lib/data/clubs'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * `Private club - Members` (`2059:6545`).
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
  const { id } = useParams<{ id: string }>()

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))
  // Enabled only once the club has come back. `getClubMembers` raises on a
  // malformed uuid, so eagerly issued it would answer `/clubs/junk/members`
  // with an error screen where the server page answered 404 — see the Timeline
  // page for the full reasoning.
  const members = useQuery(club.data ? queryKeys.clubs.members(id) : null, () =>
    getClubMembers(id)
  )

  if (club.data === null) notFound()

  // Above both gates: back and the sub-page switcher come from the URL, so they
  // stay usable while the club is arriving and when it has failed.
  const header = <ClubDetailHeader clubId={id} club={club.data} current="members" />

  const gate = combineQueries(club, members)
  if (gate.error)
    return (
      <>
        {header}
        <ErrorState onRetry={gate.refetch} />
      </>
    )

  // Both, not just the club: the count line reads from the club and the rows
  // from the roster, and drawing "12 members" over an empty list for a tick is
  // a worse artifact than one more moment of placeholder.
  if (!club.data || !members.data)
    return (
      <>
        {header}
        <SkeletonList rows={5} />
      </>
    )

  return (
    <>
      {header}

      <div className="px-4">
        <p className="mb-2 text-sm font-medium text-muted">
          {club.data.members_count} {club.data.members_count === 1 ? 'member' : 'members'}
        </p>

        <ul className="overflow-hidden rounded-lg bg-surface">
          {members.data.map((member) => (
            <li key={member.user_id}>
              <ListUser
                name={member.profile?.username ?? 'Rider'}
                avatarUrl={member.profile?.avatar_url}
                isHost={member.role === 'owner'}
                note={
                  member.role === 'member' ? undefined : member.role === 'owner' ? 'Owner' : 'Admin'
                }
              />
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
