'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { setDigestOptOut } from '@/lib/actions/profile'
import { getDigestOptOut } from '@/lib/data/profile'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * The weekly round-up's opt-out — PD-450, part 1.
 *
 * ## Why this is a second sheet and not a second checkbox in `PrivacySheet`
 *
 * PD-450: *"The opt-out is its own thing and must not be conflated with `096`'s
 * analytics opt-out. Two different consents."* That is a statement about the
 * COLUMN, and putting the two toggles under one heading called *Privacy* would
 * undo it in the only place a rider ever sees them. Sharing usage data is a
 * question about being measured; the round-up is a question about being
 * contacted, and a rider can reasonably want opposite answers.
 *
 * ## Nothing is assembled or sent today, and the copy says so
 *
 * **Part 1 ships the content rule, the reader and this opt-out — not the
 * send.** `129`'s `digest_opt_out_at` is a preference with no reader but its
 * own accessor; no job exists yet that looks at it, because a weekly send
 * needs push delivery (PD-303, deployed and inert pending two provider
 * credentials, `pg_cron`/`pg_net` and the Vault trio, none of which a session
 * can supply) and the scheduled assembler this proposal defers to part 2. A
 * sentence claiming a round-up is "put together" or delivered now would be a
 * promise this build cannot keep, which `CLAUDE.md` names as the thing to
 * audit user-facing copy for — so this component says what the round-up
 * *will* contain and that it depends on push being switched on, and commits to
 * nothing that has already happened. When part 2 ships the assembler, setting
 * this preference is what will stop it at the source; there is nothing to
 * flip in this file when that day comes.
 *
 * ## Phrased as the ON state, like `PrivacySheet`
 *
 * The stored column is `digest_opt_out_at`, so this component inverts once, at
 * `subscribed`, and never again. A checkbox labelled with a negative is the
 * reliable way to get a rider to tap the wrong one.
 */
export function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ContextMenu open={open} onClose={onClose} label="Notifications">
      <NotificationControls onClose={onClose} />
    </ContextMenu>
  )
}

function NotificationControls({ onClose }: { onClose: () => void }) {
  const online = useOnlineStatus()
  const optOut = useQuery(queryKeys.profile.digestOptOut(), getDigestOptOut)

  // Local, so the box moves under the rider's finger rather than after a round
  // trip. `pending` disables it, so the two cannot disagree for longer than one
  // in-flight write, and a failure puts it back. `PrivacySheet`'s shape.
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [override, setOverride] = useState<boolean | null>(null)

  if (optOut.error) return <ErrorState onRetry={optOut.refetch} />

  // Gated on the data, never on `isLoading` — on the first render pass there is
  // no data AND no fetch in flight, so a screen gating on `isLoading` draws
  // `undefined` where its state should be.
  if (optOut.data === undefined) {
    return (
      <div className="flex flex-col gap-6 pb-2">
        <h2 className="text-2xl font-semibold text-foreground">Notifications</h2>
        <div className="h-5 w-40 animate-pulse rounded bg-track" />
      </div>
    )
  }

  const subscribed = override ?? !optOut.data

  async function toggle(nextSubscribed: boolean) {
    setOverride(nextSubscribed)
    setError(null)
    setPending(true)
    const result = await setDigestOptOut(!nextSubscribed)
    setPending(false)
    if (result.error) {
      setOverride(null)
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-2">
      <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold text-foreground">Notifications</h2>
          {/* Names what the round-up will contain — rides near them this
              weekend, and what's moved in their clubs — and ties it to the
              one thing that is not built yet, so nothing here reads as
              already happening. See the file header. */}
          <p className="text-sm text-muted">
            A Friday-evening round-up of rides near you this weekend, and what’s moved in your
            clubs, once push notifications are switched on. You can turn it off now.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Checkbox
            checked={subscribed}
            disabled={pending || !online}
            onChange={(event) => void toggle(event.target.checked)}
            label="Send me the weekly round-up"
          />

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {!online && (
            <p className="text-xs font-medium text-muted">You’re offline — reconnect to change this.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {/* The empty-week rule, said out loud and in the future tense — PD-450
              makes it a requirement rather than an implementation detail: "a
              rider with nothing to show gets NOTHING", so a rider who reads
              this before the round-up ever exists still knows a quiet week
              means silence rather than a broken feature. */}
          <p className="text-xs text-muted">
            Once it starts, a quiet week means nothing arrives — you’ll only get a round-up when
            there’s something in it.
          </p>
        </div>
      </div>

      <Button type="button" variant="secondary" size="md" onClick={onClose}>
        Close
      </Button>
    </div>
  )
}
