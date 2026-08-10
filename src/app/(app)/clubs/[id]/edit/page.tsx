'use client'

import { notFound, useParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { EditClubForm } from '@/components/clubs/EditClubForm'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getClubForEdit } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * `Edit club` — PD-101. No v2 frame exists for this screen either;
 * `design.md` §D5 measures the drawn `Edit club` frame (`1951:8602`) as an
 * unedited copy of `Create club` — its header reads "Create club" and its
 * destructive button reads "Delete ride". The field set here is exactly
 * `CreateClubForm`'s.
 *
 * Next still nests this under `clubs/[id]/layout.tsx`, whose
 * `pt-header-sub-extra` is sized for the four sub-pages' shared switcher row
 * — a 24px top-up this screen's plain `Header` (no `subRow`) does not need
 * and there is no route-group escape from a shared ancestor layout for one
 * child route. The cost is a few extra pixels of clearance under the header,
 * never an overlap; noted here rather than silently accepted.
 */
export default function EditClubPage() {
  const { id } = useParams<{ id: string }>()

  const club = useQuery(queryKeys.clubs.edit(id), () => getClubForEdit(id))

  // `null` is decided — no such club, or one this viewer's RLS hides. Only
  // that is a 404; `undefined` is the effect not having answered yet.
  if (club.data === null) notFound()

  const header = <Header title="Edit club" backHref={`/clubs/${id}`} />

  if (club.error) {
    return (
      <>
        {header}
        <ErrorState onRetry={club.refetch} />
      </>
    )
  }

  if (!club.data) {
    return (
      <>
        {header}
        <SkeletonForm />
      </>
    )
  }

  // Permission denied is indistinguishable from empty at the query layer —
  // the clubs SELECT policy admits every member and every public club, so a
  // row coming back is not permission to edit it. This is not a not-found:
  // the rider can plainly see the club behind it.
  if (!club.data.is_owner) {
    return (
      <>
        {header}
        <p className="px-6 pt-8 text-center text-sm font-medium text-muted">
          Only the owner can edit this club.
        </p>
      </>
    )
  }

  return (
    <>
      {header}
      <div className="px-4 pb-8">
        <EditClubForm club={club.data} />
      </div>
    </>
  )
}
