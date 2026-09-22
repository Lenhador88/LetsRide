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
 * The weekly round-up's opt-out — PD-450.
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
 * ## The copy describes the IN-APP round-up, and that is not a hedge
 *
 * A weekly push cannot be sent today — `121`'s delivery chain is deployed and
 * inert, waiting on two provider credentials, `pg_cron`/`pg_net` and the Vault
 * trio, none of which a session can supply (PD-303). So a sentence promising
 * one would be a promise this build cannot keep, which `CLAUDE.md` names as the
 * thing to audit user-facing copy for.
 *
 * What ships now genuinely exists: the round-up is assembled weekly and is
 * readable in the app. **The toggle is therefore honest as written and needs no
 * edit when delivery lands** — turning it off already stops the assembly at the
 * source (`125`'s job reads `digest_opt_out_at` when it builds), so it stops
 * the push too, for free, on the day the push starts working. The one sentence
 * that would have to change is the one this file deliberately does not write:
 * any mention of a phone.
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
          {/* What it is, in one sentence, from the rider's side. It names the
              two things the round-up actually contains — rides near them this
              weekend, and what moved in their clubs — because those are the
              two the assembly job selects, and a rider deciding whether to
              keep it needs to know what they would be giving up. */}
          <p className="text-sm text-muted">
            Once a week we put together what’s coming up — rides near you this weekend, and
            what’s moved in your clubs since the last one.
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
          {/* The empty-week rule, said out loud. PD-450 makes it a requirement
              rather than an implementation detail — "a rider with nothing to
              show gets NOTHING", because an empty digest is worse than silence
              — and a rider who is told the rule up front does not read a quiet
              week as the feature being broken. */}
          <p className="text-xs text-muted">
            We only send it when there’s something in it. A quiet week means nothing arrives.
          </p>
        </div>
      </div>

      <Button type="button" variant="secondary" size="md" onClick={onClose}>
        Close
      </Button>
    </div>
  )
}
