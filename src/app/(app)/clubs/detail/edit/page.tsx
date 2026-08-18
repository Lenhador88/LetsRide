'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { EditClubForm } from '@/components/clubs/EditClubForm'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getClubForEdit } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'

/**
 * `Edit club` — PD-101. No v2 frame exists for this screen either;
 * `design.md` §D5 measures the drawn `Edit club` frame (`1951:8602`) as an
 * unedited copy of `Create club` — its header reads "Create club" and its
 * destructive button reads "Delete ride". The field set here is exactly
 * `CreateClubForm`'s.
 *
 * Next still nests this under `clubs/detail/layout.tsx`, shared with the
 * other club screens — there is no route-group escape from a shared ancestor
 * layout for one child route. That used to cost this screen an unwanted 24px
 * top-up sized for the sub-page switcher's row; the club detail merge deleted
 * the switcher and, with it, the layout's unconditional padding, so this
 * screen's plain `Header` (no `subRow`) now gets exactly the shell's 96px and
 * nothing more.
 */
export default function EditClubPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <EditClubScreen />
    </Suspense>
  )
}

function EditClubScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const club = useQuery(queryKeys.clubs.edit(id), () => getClubForEdit(id))

  // `null` is decided — no such club, or one this viewer's RLS hides. Only
  // that is a 404; `undefined` is the effect not having answered yet.
  if (club.data === null) notFound()

  const header = <Header title="Edit club" backHref={routes.club(id)} />

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
        <p className="motion-safe:animate-fade-in px-6 pt-8 text-center text-sm font-medium text-muted">
          Only the owner can edit this club.
        </p>
      </>
    )
  }

  return (
    <>
      {header}
      <div className="px-4 pt-4 pb-8 motion-safe:animate-fade-in">
        <EditClubForm club={club.data} />
      </div>
    </>
  )
}
