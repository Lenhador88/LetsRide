'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { Globe2Icon, Lock2Icon } from '@/components/icons/generated'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubMembershipButton } from '@/components/clubs/ClubMembershipButton'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListUser } from '@/components/ui/ListUser'
import { SkeletonDetail } from '@/components/ui/Skeleton'
import { getClub } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'
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
 *
 * The only screen in the group with a single read, so no `combineQueries` — it
 * exists to give a *set* of queries one error and one retry, and one query
 * already has both.
 */
export default function ClubAboutPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubAboutScreen />
    </Suspense>
  )
}

function ClubAboutScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))

  // `null` means "no such club, or a club you may not see" — deliberately the
  // same answer, so that a private club's existence is not confirmed to someone
  // outside it. `undefined` means the effect has not answered, and is not a 404.
  if (club.data === null) notFound()

  // Above both gates: back and the sub-page switcher come from the URL, so they
  // stay usable while the club is arriving and when it has failed.
  const header = <ClubDetailHeader clubId={id} club={club.data} current="about" />

  if (club.error)
    return (
      <>
        {header}
        <ErrorState onRetry={club.refetch} />
      </>
    )

  if (!club.data)
    return (
      <>
        {header}
        <SkeletonDetail />
      </>
    )

  const TypeIcon = club.data.is_public ? Globe2Icon : Lock2Icon
  const isOwner = club.data.viewer_role === 'owner'

  return (
    <>
      {header}

      <div className="flex flex-col gap-6 px-4">
        <div className="flex flex-col gap-2 rounded-lg bg-surface p-4">
          <p className="flex items-center gap-1 text-sm font-medium text-muted">
            <TypeIcon className="h-6 w-6 shrink-0" />
            {club.data.is_public ? 'Public club' : 'Private club'}
          </p>

          {club.data.description ? (
            <p className="text-sm text-foreground">{club.data.description}</p>
          ) : (
            <p className="text-sm font-medium text-muted">
              This club has not written a description, yet!
            </p>
          )}

          <p className="text-xs font-medium text-muted">
            Started {formatRideDateLong(club.data.created_at)}
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-muted">Club owner</h2>
          <div className="overflow-hidden rounded-lg bg-surface">
            <ListUser
              name={club.data.owner?.username ?? 'Rider'}
              avatarUrl={club.data.owner?.avatar_url}
              isHost
              note="Owner"
            />
          </div>
        </div>

        {!isOwner && (
          <ClubMembershipButton clubId={club.data.id} isMember={!!club.data.viewer_role} />
        )}
      </div>
    </>
  )
}
