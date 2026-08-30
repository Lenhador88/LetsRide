'use client'

import { useState, useTransition } from 'react'
import { requestToJoinClub } from '@/lib/actions/club-join-requests'
import type { ClubJoinRequestStatus } from '@/types'

/**
 * The trailing control on a PRIVATE club's Explore row — `085`, PD-325.
 *
 * A sibling of `JoinClubButton` rather than a mode on it. That component's own
 * header argues the Explore control and the club-detail control are *different
 * controls in the design, not one component with a prop*, and the same argument
 * applies again one level down: `Join club` writes a `club_members` row and
 * changes the list under the rider's finger, while this writes a request and
 * leaves the row exactly where it was.
 *
 * ## Three states, and only the first is a control
 *
 * `null` draws `Request to join`. `'pending'` draws `Requested` as plain text —
 * **not a disabled button**, because there is nothing to press and a greyed
 * control invites a second tap that `085`'s unique key would refuse with a
 * `23505` the rider never asked to see. `'declined'` draws **nothing at all**.
 *
 * ## Why a declined club still appears at all
 *
 * `private.club_takes_join_requests_for` deliberately has no declined conjunct,
 * so the club stays in Explore after a refusal. That is what makes the refusal
 * legible: `085` writes no decline notification — `036` §3's club conjunct
 * would make one unreadable to the very rider it addresses — so the club's
 * reduced screen, one tap away, is the only surface on which the answer can be
 * rendered. Removing the row would leave the request readable from psql and
 * from nowhere in the product.
 *
 * The card is silent here rather than saying "declined" on the row itself: a
 * refusal read at a glance in a list is a harsher thing than one read on the
 * club's own screen, and the row remains a link to that screen.
 *
 * `preventDefault` is not incidental, exactly as in `JoinClubButton`: the
 * card's navigation is a stretched link *under* this control, so without it a
 * tap would both send the request and open the club — and the request would be
 * invisible because the page changed.
 */
export function RequestToJoinButton({
  clubId,
  clubName,
  status,
}: {
  clubId: string
  clubName: string
  status: ClubJoinRequestStatus | null | undefined
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Optimistic only in the sense that the cache invalidation has not landed
  // yet; the write has. It stops the row flashing back to `Request to join`
  // between the RPC returning and Explore refetching.
  const [asked, setAsked] = useState(false)

  if (status === 'declined') return null

  if (status === 'pending' || asked) {
    return (
      <p className="px-1 py-1.5 text-sm font-semibold text-muted">Requested</p>
    )
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        aria-label={`Request to join ${clubName}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setError(null)
          startTransition(async () => {
            const result = await requestToJoinClub(clubId)
            if (result.error) setError(result.error)
            else setAsked(true)
          })
        }}
        className="rounded px-1 py-1.5 text-sm font-semibold text-accent transition-opacity disabled:opacity-50"
      >
        {pending ? 'Asking…' : 'Request to join'}
      </button>

      {/* The live region has to exist before its content changes, or a screen
          reader announces nothing — `JoinClubButton`'s note, and the same
          defect review caught on the profile form. */}
      <p role="status" aria-live="polite" className="text-2xs text-danger empty:hidden">
        {error}
      </p>
    </div>
  )
}
