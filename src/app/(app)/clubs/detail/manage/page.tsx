'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubJoinRequestsSection } from '@/components/clubs/ClubJoinRequestsSection'
import { ClubDeclinedRequestsSection } from '@/components/clubs/ClubDeclinedRequestsSection'
import { ManageRidersRoster } from '@/components/clubs/ManageRidersRoster'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub, getClubMembers } from '@/lib/data/clubs'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'

/**
 * `Manage riders` — `088`, PD-326. Reached from `ClubOptionsMenu` and from
 * nowhere else.
 *
 * Product owner, 2026-08-27: *"There is a 'Manage riders' section in the 3
 * dots, that allows admins to accept new riders, remove existing riders, or
 * promote riders to admins."* All three live here, in that order: the pending
 * requests first because they are the only thing on this screen that is a
 * to-do, then the roster, then the refusals an admin can lift.
 *
 * ## Why this is its own route rather than the Members screen with extra rows
 *
 * `/clubs/detail/members` is the read-only roster **every** member sees, and
 * most of its readers may do none of this. One screen serving both would have
 * to hide half of itself from most of its readers — and it would have to
 * decide that in the client, off `viewer_role`, which `ClubDetail`'s own
 * docstring calls a display hint rather than authorization.
 *
 * It also absorbs `085`'s `ClubJoinRequestsSection` from the club detail,
 * which that change's own `design.md` Q7 said PD-326 would do: it put the
 * minimum approval surface on the detail screen precisely so PD-326 would have
 * a section to move rather than a route to delete.
 *
 * ## The gate here is a screen, never a permission
 *
 * A rider who guesses the URL gets `notFound()` — but that is the courtesy,
 * not the enforcement. `088`'s three RPCs each re-check the caller's authority
 * in their own body, where `security definer` makes it load-bearing, and each
 * refuses with one indistinguishable `42501`. Defeating this branch reaches a
 * screen whose every control the database says no to.
 *
 * **The gate is `viewer_is_owner || viewer_role === 'admin'`, and the first
 * disjunct is not redundant** (PD-280, and `ClubJoinRequestsSection`'s own
 * header): ownership is a column on `clubs` and `viewer_role` is a
 * `club_members` row, and the two diverge for an owner holding no roster row —
 * a state `enforce-creator-membership` calls reachable on demand. Gating on
 * the role alone would lock exactly that owner out of their own club's
 * administration. `private.is_club_admin_for` has the matching owner arm,
 * which is what makes the screen and the RPCs agree.
 */
export default function ClubManageRidersPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubManageRidersScreen />
    </Suspense>
  )
}

function ClubManageRidersScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))
  // Enabled only once the club has come back, matching the Members screen:
  // `getClubMembers` raises on a malformed uuid, so eagerly issued it would
  // answer `/clubs/detail/manage?id=junk` with an error screen where this page
  // answers 404.
  const members = useQuery(club.data ? queryKeys.clubs.members(id) : null, () =>
    getClubMembers(id)
  )

  if (club.data === null) notFound()
  // `undefined` is "not yet" and only `null` is decided — so this waits rather
  // than flashing a 404, and the authority check below runs on a real answer.
  if (club.data && !(club.data.viewer_is_owner || club.data.viewer_role === 'admin')) {
    notFound()
  }

  // Above both gates: back comes from the URL, so it stays usable while the
  // club is arriving and when it has failed.
  const header = <ClubDetailHeader clubId={id} club={club.data} current="members" />

  const gate = combineQueries(club, members)

  return (
    <>
      {header}

      <div className="flex flex-col gap-6 pt-4">
        {gate.error ? (
          <ErrorState onRetry={gate.refetch} />
        ) : !club.data || !members.data ? (
          <SkeletonList rows={5} />
        ) : (
          <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
            {/* First, because it is the only thing here that is a to-do. Draws
                nothing at all when there is none — see its own header. */}
            <ClubJoinRequestsSection clubId={id} club={club.data} />
            <ManageRidersRoster clubId={id} club={club.data} members={members.data} />
            <ClubDeclinedRequestsSection clubId={id} club={club.data} />
          </div>
        )}
      </div>
    </>
  )
}
