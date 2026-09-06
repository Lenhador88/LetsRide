'use client'

import { useState } from 'react'

import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { unblockRider } from '@/lib/actions/blocks'
import { getBlockedRiders } from '@/lib/data/moderation'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { formatPostcardDate } from '@/lib/utils'

/**
 * The blocked-riders half of PD-298 — the first caller `unblockRider` has ever
 * had.
 *
 * ## Why the confirm is inline and not a sheet
 *
 * `ManageRidersRoster` confirms a removal by opening a `ContextMenu`, and that
 * is the house pattern — but it is on a *page*. This list renders inside
 * `PrivacySheet`, which is already a `ContextMenu`, and that component's focus
 * trap assumes it is the only one mounted open at once (`ProfileMenu` closes
 * itself before opening any of its three sheets for exactly this reason). So
 * the confirm expands the row in place instead. Same two-step protection, no
 * second trap.
 *
 * ## Why it confirms at all
 *
 * Unblocking is the reversal of a safety action, and this screen exists because
 * one misplaced tap is expensive. A misplaced tap *here* is expensive in the
 * other direction — it puts back someone a rider deliberately removed — so the
 * cheap thing to get wrong is guarded the same way the original was not.
 *
 * ## A null username is a real row, not a defect
 *
 * `105` deliberately does not restate `009`'s `username is not null` conjunct;
 * see `BlockedRider`. A rider who blocked someone mid-onboarding gets a row
 * with no name, and it must still be liftable — dropping it would leave a block
 * nobody can ever undo, which is this story's own bug one level down.
 */
export function BlockedRidersList() {
  const online = useOnlineStatus()
  const showBanner = useBanner()
  const blocked = useQuery(queryKeys.profile.blockedRiders(), getBlockedRiders)

  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  async function run(blockedId: string, name: string) {
    setPending(blockedId)
    const result = await unblockRider(blockedId)
    setPending(null)
    setConfirming(null)

    if (result.error) showBanner(result.error, 'error')
    else showBanner(`${name} is unblocked`)
  }

  // Its own error state rather than the sheet's, so a failure here leaves the
  // analytics toggle and the hidden list working — one read failing must not
  // blank a settings screen.
  if (blocked.error) {
    return (
      <Section>
        <ErrorState onRetry={blocked.refetch} />
      </Section>
    )
  }

  // Gated on the data, never on `isLoading`: on the first render pass there is
  // no data AND no fetch in flight, so `isLoading` is false and a screen gating
  // on it draws `undefined`.
  if (blocked.data === undefined) {
    return (
      <Section>
        <div className="h-5 w-40 animate-pulse rounded bg-track" />
      </Section>
    )
  }

  if (blocked.data.length === 0) {
    return (
      <Section>
        <p className="text-sm text-muted">You haven’t blocked anyone.</p>
      </Section>
    )
  }

  return (
    <Section>
      <ul className="flex flex-col gap-3">
        {blocked.data.map((rider) => {
          const name = rider.username ?? 'A rider who hasn’t finished signing up'
          const busy = pending === rider.blocked_id
          const isConfirming = confirming === rider.blocked_id

          return (
            <li key={rider.blocked_id} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                {/* No `src`: `105` returns no avatar path, because signing runs
                    as the rider and 010's avatar policy resolves through the
                    `profiles` RLS this accessor exists to bypass. Initials are
                    the honest render, not a fallback. */}
                <Avatar name={name} size="sm" className="h-10 w-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-semibold ${
                      rider.username ? 'text-foreground' : 'text-muted italic'
                    }`}
                  >
                    {name}
                  </p>
                  <p className="text-xs text-muted">
                    Blocked {formatPostcardDate(rider.blocked_at)}
                  </p>
                </div>

                {!isConfirming && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirming(rider.blocked_id)}
                    disabled={!online || pending !== null}
                  >
                    Unblock
                  </Button>
                )}
              </div>

              {isConfirming && (
                <div className="flex flex-col gap-2 rounded-lg bg-track p-3">
                  <p className="text-sm text-foreground">
                    Unblock {name}? You’ll both be able to see each other again.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setConfirming(null)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void run(rider.blocked_id, name)}
                      loading={busy}
                      disabled={!online}
                    >
                      Unblock
                    </Button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-foreground">Blocked riders</h3>
      {children}
    </section>
  )
}
