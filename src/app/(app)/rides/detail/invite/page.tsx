'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ErrorState } from '@/components/ui/ErrorState'
import { RideHeader } from '@/components/rides/RideHeader'
import { RideInviteList } from '@/components/rides/RideInviteList'
import { RideInvitePicker } from '@/components/rides/RideInvitePicker'
import { getRide } from '@/lib/data/rides'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'

/**
 * `Invite riders` — the organizer's picker and the list of who they have
 * already asked (`083`, PD-329).
 *
 * **There is no v2 frame.** `npm run figma -- ls Invite` finds `Invite riders`
 * and `Invite riders - Filled` under `Rides`, and both are OLD-stylesheet
 * frames — `Grey (OLD)/*`, `Accent (OLD)/100` — which decision #4 supersedes.
 * The composition is read from them (search field, flat result list, header)
 * and everything drawn comes from v2 primitives this app already ships. Logged
 * in the PR rather than presented as measured.
 *
 * ## Organizer only, and absent rather than disabled for everyone else
 *
 * `083`'s INSERT policy is the enforcement — a crew member or a club member is
 * refused by the database whatever this screen draws. What this screen owes is
 * not to *offer* what will be refused: a rider who is not the organizer sees
 * the not-found every unreachable ride screen shows, not a greyed-out picker.
 * A disabled control is a promise.
 *
 * **`notFound()` for the non-organizer rather than a message**, and it costs
 * nothing: they can already see the ride, so this is not hiding its existence —
 * it is saying this screen is not one of theirs, the same answer `/rides/detail/
 * edit` gives.
 */
export default function RideInvitePage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per ride — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <RideInviteScreen />
    </Suspense>
  )
}

function RideInviteScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''
  const ride = useQuery(queryKeys.rides.detail(id), () => getRide(id))

  // `null` is decided — no such ride, or none this rider may see. `undefined`
  // is the effect not having answered, and 404ing on it would flash one on
  // every load.
  if (ride.data === null) notFound()
  // Decided, and separately: the ride resolved and this rider does not organise
  // it. Only checked once the read has landed, for the same reason.
  if (ride.data && !ride.data.is_organizer) notFound()

  return (
    <>
      <RideHeader
        rideId={id}
        title={ride.data?.title}
        current="invite"
        isCrew={ride.data?.is_crew}
        isOrganizer={ride.data?.is_organizer}
      />

      <div className="flex flex-col gap-6 pt-4 pb-4">
        {ride.error ? (
          <ErrorState onRetry={ride.refetch} />
        ) : (
          // Both children read their own data and own their own three states,
          // so they render as soon as the ride has resolved rather than waiting
          // on each other. The ride read above is the authorization probe and
          // nothing else on this screen depends on its contents.
          ride.data && (
            <>
              <RideInvitePicker rideId={id} />
              <RideInviteList rideId={id} />
            </>
          )
        )}
      </div>
    </>
  )
}
