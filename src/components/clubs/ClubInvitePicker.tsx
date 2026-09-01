'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { Input } from '@/components/ui/Input'
import { ListUser } from '@/components/ui/ListUser'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { inviteRiderToClub } from '@/lib/actions/club-invites'
import { searchRidersToInviteToClub } from '@/lib/data/club-invites'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { RIDER_SEARCH_MIN_LENGTH } from '@/lib/validation/rides'

/**
 * The rider picker for a club invite — `093`, PD-360, `RideInvitePicker`'s
 * shape one domain over.
 *
 * ## There is no v2 frame for this
 *
 * `npm run figma -- ls "*nvite*"` finds nothing under Clubs (task 0.9's own
 * expectation, confirmed) — the composition is `RideInvitePicker`'s: a search
 * field at the top, a flat list of `ListUser` rows under it, each with an
 * `Invite` button. Nothing here is measured off a frame and nothing invented
 * is called measured.
 *
 * ## What the search may return, and what bounds it
 *
 * `searchRidersToInviteToClub` owns that argument in full — prefix-only, two
 * characters minimum, capped and unpaginated, `RIDER_SEARCH_MIN_LENGTH`'s own
 * bound. An empty result is one message for every reason: no such rider, a
 * blocked rider, one already a member, one already invited. Telling them
 * apart is what would make this an oracle.
 */
export function ClubInvitePicker({ clubId }: { clubId: string }) {
  const [query, setQuery] = useState('')
  const [inviting, setInviting] = useState<string | null>(null)
  const online = useOnlineStatus()
  const showBanner = useBanner()

  const trimmed = query.trim()
  const long = trimmed.length >= RIDER_SEARCH_MIN_LENGTH

  const hits = useQuery(long ? queryKeys.clubInvites.search(clubId, trimmed) : null, () =>
    searchRidersToInviteToClub(clubId, trimmed)
  )

  async function invite(riderId: string) {
    setInviting(riderId)
    const result = await inviteRiderToClub(clubId, riderId)
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

      {/* Gated on the DATA, never on `isLoading` — see `RideInvitePicker`. */}
      {!long ? (
        <p className="px-4 text-sm text-muted">
          Type at least {RIDER_SEARCH_MIN_LENGTH} characters of a rider’s username.
        </p>
      ) : hits.error ? (
        // No retry button: the next keystroke is the retry.
        <p className="px-4 text-sm text-muted">Could not search just now. Try typing again.</p>
      ) : !hits.data ? (
        <SkeletonList rows={3} />
      ) : hits.data.length === 0 ? (
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
