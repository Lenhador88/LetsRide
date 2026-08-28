'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { Input } from '@/components/ui/Input'
import { ListUser } from '@/components/ui/ListUser'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { inviteRiderToRide } from '@/lib/actions/ride-invites'
import { searchRidersToInvite } from '@/lib/data/ride-invites'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { RIDER_SEARCH_MIN_LENGTH } from '@/lib/validation/rides'

/**
 * The rider picker — `083`, PD-329, and the app's first people search.
 *
 * ## There is no v2 frame for this
 *
 * `npm run figma -- ls Invite` finds `Invite riders` and `Invite riders -
 * Filled` under `Rides`, and both are **OLD-stylesheet** frames: every token in
 * them is `Grey (OLD)/*` and `Accent (OLD)/100`, which decision #4 supersedes.
 * So the *composition* is read from them — a search field at the top, a flat
 * list of `Search Results / User` rows under it, a `Done` in the header — and
 * every token, size and component is taken from the v2 primitives this app
 * already ships (`Input`, `ListUser`, `Button`). Nothing here is measured off
 * those frames and nothing invented is called measured.
 *
 * ## What the search may return, and what bounds it
 *
 * `searchRidersToInvite` owns that argument in full; the two things visible
 * from here are that nothing renders below `RIDER_SEARCH_MIN_LENGTH`
 * characters, and that an empty result is one message for every reason — no
 * such rider, a blocked rider, one already invited, one already riding. Telling
 * them apart is what would make this an oracle.
 */
export function RideInvitePicker({ rideId }: { rideId: string }) {
  const [query, setQuery] = useState('')
  const [inviting, setInviting] = useState<string | null>(null)
  const online = useOnlineStatus()
  const showBanner = useBanner()

  const trimmed = query.trim()
  const long = trimmed.length >= RIDER_SEARCH_MIN_LENGTH

  // `long ? key : null` — the gate `DeleteAccountSheet` uses for its impact
  // read. One character must issue no request at all, not a request that is
  // then discarded.
  const hits = useQuery(long ? queryKeys.invites.search(rideId, trimmed) : null, () =>
    searchRidersToInvite(rideId, trimmed)
  )

  async function invite(riderId: string) {
    setInviting(riderId)
    const result = await inviteRiderToRide(rideId, riderId)
    setInviting(null)
    showBanner(result.error ?? 'Invite sent', result.error ? 'error' : undefined)
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="px-4">
        <Input
          label="Find a rider"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      {/* Gated on the DATA, never on `isLoading` — `useQuery` starts its fetch
          in an effect, so on the first pass there is no data and no fetch in
          flight, and a screen gating on the flag renders `undefined` where its
          list should be. */}
      {!long ? (
        <p className="px-4 text-sm text-muted">
          Type at least {RIDER_SEARCH_MIN_LENGTH} characters of a rider’s username.
        </p>
      ) : hits.error ? (
        // No retry button: the next keystroke is the retry, and a rider who has
        // to press something to search again will simply type instead.
        <p className="px-4 text-sm text-muted">Could not search just now. Try typing again.</p>
      ) : !hits.data ? (
        <SkeletonList rows={3} />
      ) : hits.data.length === 0 ? (
        // ONE message for every reason. See the header.
        <p className="px-4 text-sm text-muted">No riders to invite for that.</p>
      ) : (
        <ul>
          {hits.data.map((rider) => (
            <li key={rider.id} className="flex items-center gap-2 pr-4">
              <ListUser
                name={rider.username ?? 'Rider'}
                avatarUrl={rider.avatar_url}
                className="min-w-0 flex-1"
              />
              <Button
                size="sm"
                onClick={() => invite(rider.id)}
                loading={inviting === rider.id}
                disabled={!online || inviting !== null}
              >
                Invite
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
