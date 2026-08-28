'use client'

import { useState, useTransition } from 'react'
import { Lock2Icon, LocationOutlineIcon } from '@/components/icons/generated'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { Button } from '@/components/ui/Button'
import { requestToJoinClub } from '@/lib/actions/club-join-requests'
import type { ClubPreview } from '@/types'

/**
 * What a rider sees when they tap a PRIVATE club they are not in — `085`,
 * PD-325.
 *
 * ## Why this screen exists at all
 *
 * `ClubCard` wraps its whole row in a stretched link, so making private clubs
 * findable in Explore made every one of them a tap into `getClub` → `null` →
 * `notFound()`. A rider would find a club and land on a 404.
 *
 * Two alternatives were rejected. **Not navigating** turns a card that is a
 * link everywhere else into a dead surface and explains nothing. **The full
 * screen with every section empty** would need the rides strip, the postcard
 * carousel, the threads section and the member rail each to return zero rows
 * and be DRAWN as empty — which is precisely the "permission denied looks
 * identical to empty" trap, four times on one screen, and it would show a
 * non-member four empty-state sentences that each assert something false about
 * the club.
 *
 * ## The property that makes this branch safe
 *
 * **It issues no query that could return zero rows.** Everything it draws comes
 * from `getClubPreview`'s seven columns, so "permission denied" and "empty"
 * cannot be confused here — there is no read whose emptiness would have to be
 * interpreted. Every section of the full screen is *absent* rather than empty:
 * no rides strip, no create-ride row (`017`'s policy would refuse it, and a
 * control that always fails RLS is worse than no control), no postcards, no
 * threads, no member rail, no description placeholder — that sentence claims
 * the club has none and this screen does not know — and no `MarkClubSeen`,
 * since `015` refuses a watermark for a club you have not joined.
 *
 * `ClubOptionsMenu` is absent too: Leave, Edit and Delete are all member or
 * owner actions.
 *
 * ## It is the only place a decline is told
 *
 * `085` writes no decline notification, because `036` §3's SELECT policy
 * conjuncts the club's readability under the reader's own RLS and a declined
 * requester holds no membership row — such a notification would be written and
 * never returned. So the requester's own `club_join_requests` row IS the
 * record, and this screen is what renders it. That is also why
 * `private.club_takes_join_requests_for` has no declined conjunct: the club has
 * to stay discoverable for this screen to be reachable at all.
 */
export function ClubPreviewScreen({ club }: { club: ClubPreview }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)

  const requested = club.request_status === 'pending' || asked
  const declined = club.request_status === 'declined'

  return (
    <>
      {/* `avatar_url` is null by construction — 016's storage policy refuses
          the object to a non-member — so the header draws the club's initials.
          Correct rather than missing; see `ClubPreview`. */}
      <ClubDetailHeader
        clubId={club.id}
        club={{ name: club.name, avatar_url: club.avatar_url }}
        current="detail"
      />

      <div className="flex flex-col gap-4 pt-4 motion-safe:animate-fade-in">
        <div className="flex flex-col gap-1 px-4">
          <p className="flex items-center gap-1 text-sm font-medium text-muted">
            <Lock2Icon className="h-6 w-6 shrink-0" />
            <span className="min-w-0 truncate">Private club</span>
          </p>
          {club.location_name && (
            <p className="flex items-center gap-1 text-sm font-medium text-muted">
              <LocationOutlineIcon className="h-6 w-6 shrink-0" />
              <span className="min-w-0 truncate">{club.location_name}</span>
            </p>
          )}
          <p className="text-sm font-medium text-muted">
            {club.members_count === 1 ? '1 rider' : `${club.members_count} riders`}
          </p>
        </div>

        {/* The sentence the card cannot say, and the whole reason this branch
            exists rather than the row simply not navigating. It names the
            state without claiming anything about the club's contents. */}
        <p className="px-4 text-sm text-foreground">
          This club is private. Its rides, postcards, threads and members are for
          its members.
        </p>

        <div className="px-4">
          {declined ? (
            // The refusal, told once and plainly, in the only place it can be
            // told. No admin is named: there is deliberately no `responded_by`
            // column, because a club refuses as a club and the requester can
            // read every column on their own row.
            <p role="status" className="text-sm text-muted">
              You asked to join. The club said no.
            </p>
          ) : requested ? (
            <p role="status" className="text-sm text-muted">
              You have asked to join. The club&rsquo;s admins will answer.
            </p>
          ) : (
            <>
              <Button
                onClick={() => {
                  setError(null)
                  startTransition(async () => {
                    const result = await requestToJoinClub(club.id)
                    if (result.error) setError(result.error)
                    else setAsked(true)
                  })
                }}
                loading={pending}
                variant="primary"
                size="lg"
                className="w-full"
              >
                Request to join club
              </Button>
              <p role="status" aria-live="polite" className="mt-2 text-sm text-danger empty:hidden">
                {error}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
