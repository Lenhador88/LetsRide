'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreateRideThreadForm } from '@/components/rides/CreateRideThreadForm'
import { Header } from '@/components/layout/Header'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'

/**
 * `Start a thread` on a ride (`108`, PD-402).
 *
 * **This screen reads nothing.** It needs the ride id and nothing else, so there
 * is no `useQuery` here and no loading treatment — and deliberately no crew
 * check either: `108`'s INSERT policy is what decides, and a client copy of it
 * would be a second rule free to drift and weaker than the one behind it. A
 * non-crew rider who reaches this URL gets the form and a refusal, which is the
 * same answer every other create screen in this app gives.
 *
 * A plain `Header` rather than `RideHeader`, matching `/clubs/detail/threads/new`
 * and `/rides/detail/edit`: this is a create screen rather than one of the
 * ride's own tabs, so it draws no threads button and no options menu — there is
 * nothing here to act on yet.
 *
 * The composition is ours — there is no v2 frame for it; see
 * `CreateRideThreadForm`.
 */
export default function NewRideThreadPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per ride — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <NewRideThreadScreen />
    </Suspense>
  )
}

function NewRideThreadScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  return (
    <>
      {/* Back to the ride's Threads list rather than to the ride: this screen is
          only ever reached from there or from the ride's create sheet, and the
          list is where the new thread's siblings are. A malformed id falls back
          to the tab root, matching `backFromCreateScreen`'s rule. */}
      <Header
        title="Start a thread"
        backHref={id ? routes.rideThreads(id) : '/rides'}
      />

      <div className="px-4 pt-4 pb-8">
        <CreateRideThreadForm rideId={id} />
      </div>
    </>
  )
}
