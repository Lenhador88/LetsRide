'use client'

import { notFound, useParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { EditRideForm } from '@/components/rides/EditRideForm'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getMyClubs } from '@/lib/data/clubs'
import { getRideForEdit } from '@/lib/data/rides'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * `Edit ride` — PD-101. No v2 frame exists for this screen; `design.md` §D5
 * measures the drawn `Edit ride` frame (`1918:15995`) as OLD-stylesheet
 * throughout, drawing five fields the schema has no column for. The field
 * set here is exactly `CreateRideForm`'s.
 *
 * **`clubs` never gates this screen.** It only shapes the club picker, and
 * `ride-lifecycle`'s "partial" state requires the picker to degrade to
 * disabled rather than take the whole screen down — see `EditRideForm`.
 */
export default function EditRidePage() {
  const { id } = useParams<{ id: string }>()

  const ride = useQuery(queryKeys.rides.edit(id), () => getRideForEdit(id))
  const clubs = useQuery(queryKeys.clubs.mine(), getMyClubs)

  // `null` is decided — no such ride, or one this viewer's RLS hides. Only
  // that is a 404; `undefined` is the effect not having answered yet.
  if (ride.data === null) notFound()

  const header = <Header title="Edit ride" backHref={`/rides/${id}`} />

  if (ride.error) {
    return (
      <>
        {header}
        <ErrorState onRetry={ride.refetch} />
      </>
    )
  }

  if (!ride.data) {
    return (
      <>
        {header}
        <SkeletonForm />
      </>
    )
  }

  // Permission denied is indistinguishable from empty at the query layer —
  // the rides SELECT policy admits crew and club members who did not
  // organise the ride, so a row coming back is not permission to edit it.
  // This is not a not-found: the rider can plainly see the ride behind it.
  if (!ride.data.is_organizer) {
    return (
      <>
        {header}
        <p className="px-6 pt-8 text-center text-sm font-medium text-muted">
          Only the organizer can edit this ride.
        </p>
      </>
    )
  }

  return (
    <>
      {header}
      <div className="px-4 pb-8">
        <EditRideForm ride={ride.data} clubs={clubs.error ? null : clubs.data} />
      </div>
    </>
  )
}
