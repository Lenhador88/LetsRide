'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { deleteClub } from '@/lib/actions/clubs'
import { getClubDeletionImpact } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * The destructive control at the foot of `/clubs/detail/edit` — PD-101,
 * `design.md` §D4, `club-lifecycle`'s delete requirement.
 *
 * **It is no longer the only way in (PD-280).** `ClubOptionsMenu` has a `Delete
 * club` row now, opening `DeleteClubSheet` below — this same panel, refusing
 * just as hard. `docs/FIGMA-FIDELITY-TODO.md` §Club detail carries why that
 * reverses a deliberate omission rather than drifting from one.
 *
 * **This is the one confirmation in the app whose numbers are a specified
 * deliverable, not copy.** Deleting a club destroys other members' postcards
 * and rides, and until this shipped nothing told the owner that. Every count
 * is read under the owner's own RLS and is therefore a **floor**, phrased "at
 * least N" rather than "N" — a blocked rider's postcards and rides are
 * invisible to this read and are destroyed regardless. A privileged,
 * unfiltered count is deliberately not built: it would tell the owner exactly
 * how much content a rider who has blocked them holds, which is the thing
 * blocking exists to withhold. Member count is **not** a floor in the same
 * sense as the other two — `club_members` SELECT hides a blocked member from
 * the owner too, so it undercounts for the identical reason — and is read
 * alongside them rather than from `ClubDetail.members_count`, so this panel
 * has one source for every number it shows instead of two that could
 * disagree.
 *
 * **If the counts cannot be read, the confirmation refuses rather than
 * showing zero** — `ready` below is false whenever `impact.error` is set or
 * `impact.data` has not arrived, which disables the confirm button rather
 * than offering a blast radius nothing measured.
 *
 * Invalidate-then-navigate ordering matches `DeleteRideControl` — see its
 * header for why the race is decided by synchronous ordering rather than by
 * construction.
 */
export function DeleteClubControl({ clubId }: { clubId: string }) {
  const [confirming, setConfirming] = useState(false)
  const online = useOnlineStatus()

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      {!confirming ? (
        <Button
          type="button"
          variant="danger"
          size="lg"
          disabled={!online}
          onClick={() => setConfirming(true)}
        >
          Delete club
        </Button>
      ) : (
        <div className="rounded-lg bg-surface p-4">
          <ClubDeleteConfirmation clubId={clubId} onCancel={() => setConfirming(false)} />
        </div>
      )}

      {/* Only while the trigger is what is showing — the confirmation draws its
          own copy of this line, and two of them stacked reads as a stutter. */}
      {!online && !confirming && (
        <p className="text-xs font-medium text-muted">
          You’re offline — reconnect to delete this club.
        </p>
      )}
    </div>
  )
}

/**
 * The same confirmation, over whichever screen opened it — `ClubOptionsMenu`'s
 * `Delete club` row (PD-280). `DeleteRideSheet`'s header has why this is a
 * sheet rather than `PostcardMenu`'s two-tap row; the argument is stronger
 * here, because the numbers below are a specified deliverable.
 */
export function DeleteClubSheet({
  clubId,
  open,
  onClose,
}: {
  clubId: string
  open: boolean
  onClose: () => void
}) {
  return (
    <ContextMenu open={open} onClose={onClose} label="Delete this club">
      <div className="p-2">
        <ClubDeleteConfirmation clubId={clubId} onCancel={onClose} />
      </div>
    </ContextMenu>
  )
}

/**
 * What both surfaces above draw. Mounted only while a rider is actually
 * confirming, which is what gates the impact read — that used to be
 * `confirming ? key : null` and is now the same gate by construction.
 */
function ClubDeleteConfirmation({ clubId, onCancel }: { clubId: string; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const online = useOnlineStatus()

  const impact = useQuery(queryKeys.clubs.deletionImpact(clubId), () =>
    getClubDeletionImpact(clubId)
  )
  const ready = online && !impact.error && !!impact.data

  function onConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await deleteClub(clubId)
      if (result.error) {
        setError(result.error)
        return
      }
      router.replace('/clubs')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {impact.error ? (
        <p role="alert" className="text-sm text-danger">
          What this would destroy could not be counted. Try again before deleting.
        </p>
      ) : !impact.data ? (
        <p className="text-sm text-muted">Checking what this would destroy…</p>
      ) : (
        <p className="text-sm text-foreground">
          This permanently deletes at least {impact.data.postcards}{' '}
          {impact.data.postcards === 1 ? 'postcard' : 'postcards'} — including other members’
          — and at least {impact.data.ridesToDelete}{' '}
          {impact.data.ridesToDelete === 1 ? 'ride' : 'rides'}, each taking its crew list and
          entire chat history with it. At least {impact.data.members}{' '}
          {impact.data.members === 1 ? 'member' : 'members'} will lose the club. This cannot
          be undone.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={onCancel}
          disabled={pending}
        >
          Keep club
        </Button>
        <Button
          type="button"
          variant="danger"
          className="flex-1"
          onClick={onConfirm}
          loading={pending}
          disabled={!ready}
        >
          Delete club
        </Button>
      </div>

      {!online && (
        <p className="text-xs font-medium text-muted">
          You’re offline — reconnect to delete this club.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
