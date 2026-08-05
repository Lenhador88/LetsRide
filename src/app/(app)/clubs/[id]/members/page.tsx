import { notFound } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ListUser } from '@/components/ui/ListUser'
import { getClub, getClubMembers } from '@/lib/data/clubs'

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
 */
export default async function ClubMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const club = await getClub(id)
  if (!club) notFound()

  const members = await getClubMembers(club.id)

  return (
    <>
      <ClubDetailHeader club={club} current="members" />

      <p className="mb-2 text-sm font-medium text-muted">
        {club.members_count} {club.members_count === 1 ? 'member' : 'members'}
      </p>

      <ul className="overflow-hidden rounded-lg bg-surface">
        {members.map((member) => (
          <li key={member.user_id}>
            <ListUser
              name={member.profile?.username ?? 'Rider'}
              avatarUrl={member.profile?.avatar_url}
              isHost={member.role === 'owner'}
              note={member.role === 'member' ? undefined : member.role === 'owner' ? 'Owner' : 'Admin'}
            />
          </li>
        ))}
      </ul>
    </>
  )
}
