import { notFound } from 'next/navigation'
import { Globe2Icon, Lock2Icon } from '@/components/icons/generated'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubMembershipButton } from '@/components/clubs/ClubMembershipButton'
import { ListUser } from '@/components/ui/ListUser'
import { getClub } from '@/lib/data/clubs'
import { formatRideDateLong } from '@/lib/utils'

/**
 * `Private club - About` (`2059:6700`).
 *
 * This is where join and leave live. The design puts club actions behind the
 * header's `Options` control, which it never draws the contents of — so rather
 * than invent a destructive menu, the one action that is unambiguous gets a
 * labelled place on the page that describes the club. See `ClubDetailHeader`
 * for why the Options control itself is omitted rather than stubbed.
 *
 * **The owner is offered nothing.** Leaving a club you own would orphan it, and
 * neither `001` nor any action guards against that — `clubs.owner_id` has no
 * transfer path because the design draws none. Hiding the control is the honest
 * response to a rule the database does not enforce; adding a guard here would
 * put it in the weaker of the two places.
 */
export default async function ClubAboutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const club = await getClub(id)
  if (!club) notFound()

  const TypeIcon = club.is_public ? Globe2Icon : Lock2Icon
  const isOwner = club.viewer_role === 'owner'

  return (
    <>
      <ClubDetailHeader club={club} current="about" />

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 rounded-lg bg-surface p-4">
          <p className="flex items-center gap-1 text-sm font-medium text-muted">
            <TypeIcon className="h-6 w-6 shrink-0" />
            {club.is_public ? 'Public club' : 'Private club'}
          </p>

          {club.description ? (
            <p className="text-sm text-foreground">{club.description}</p>
          ) : (
            <p className="text-sm font-medium text-muted">
              This club has not written a description, yet!
            </p>
          )}

          <p className="text-xs font-medium text-muted">
            Started {formatRideDateLong(club.created_at)}
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-muted">Club owner</h2>
          <div className="overflow-hidden rounded-lg bg-surface">
            <ListUser
              name={club.owner?.username ?? 'Rider'}
              avatarUrl={club.owner?.avatar_url}
              isHost
              note="Owner"
            />
          </div>
        </div>

        {!isOwner && <ClubMembershipButton clubId={club.id} isMember={!!club.viewer_role} />}
      </div>
    </>
  )
}
