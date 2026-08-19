'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { Input } from '@/components/ui/Input'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { deleteAccount } from '@/lib/actions/auth'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { getAccountDeletionImpact } from '@/lib/data/profile'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

function noop(): void {}

/**
 * `Context Menu / Confirm account deletion` (`2303:9370`) — opened by
 * `ProfileMenu`'s Delete account row, over `/profile` rather than as a route
 * of its own; see that file's header for how the Figma tree settled that.
 * The frame draws a title, a body line and two buttons at 390×232; this adds
 * two things it does not draw, both by design's own instruction rather than
 * invention:
 *
 * - **The impact summary** (`account-deletion`'s "confirmation names the
 *   collateral"). `design.md` calls the counts "an addition to it, not a
 *   redesign of it" — rendered only when there is something to report, per
 *   the sibling scenario that a rider with nothing to lose sees the drawn
 *   frame and nothing else. If the read fails or has not landed, this
 *   renders nothing rather than a broken table: **the deletion is not
 *   blocked on it**, unlike `DeleteClubControl`'s stricter gate, because
 *   Apple's 5.1.1(v) — the reason this feature exists — refuses an app that
 *   puts steps between a rider and deletion, and this summary is
 *   informational only (`account-erasure-cascade`'s own "cannot be trusted
 *   as authorisation").
 * - **The password field** (design D6, Q7 — decided 2026-08-14, require the
 *   password). The frame draws none; task 3.3 says build it from the
 *   nearest existing `<Input>` usage and say which. This is `LoginPage`'s:
 *   a labelled `type="password"` field with `autoComplete="current-password"`,
 *   placed between the body copy and the buttons.
 *
 * **Offline disables the destructive button rather than only refusing on
 * submit** — matching `DeleteClubControl`/`DeleteRideControl` — and
 * `deleteAccount` itself refuses again at the boundary (design D7, Q11): the
 * one write in this app that must never be optimistic.
 */
export function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const online = useOnlineStatus()
  const [state, formAction, pending] = useActionState(deleteAccount, emptyActionState)
  useActionRedirect(state)

  // `open ? key : null` — DeleteClubControl/DeleteRideControl's own gate.
  // Most visits to /profile never open this sheet, so there is no reason to
  // read the impact counts until a rider does.
  const impact = useQuery(open ? queryKeys.profile.deletionImpact() : null, getAccountDeletionImpact)
  const data = impact.data

  return (
    // While pending, Escape and the scrim are refused rather than only the
    // Cancel button — the account-deletion spec's "in flight" scenario:
    // dismissing the sheet must not read as a way to walk away from a call
    // that is still running. The action itself is unaffected either way —
    // this component stays mounted for the life of /profile, so the
    // submission and its eventual redirect complete regardless.
    <ContextMenu open={open} onClose={pending ? noop : onClose} label="Delete account">
      <div className="flex flex-col gap-6 pb-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold text-foreground">Delete account?</h2>
          <p className="text-sm text-muted">This action cannot be undone.</p>
        </div>

        {data && (data.clubsChangingHands > 0 || data.ridesToCancel > 0) && (
          <p className="text-sm text-foreground">
            {data.clubsChangingHands > 0 && (
              <>
                {data.clubsChangingHands} {data.clubsChangingHands === 1 ? 'club' : 'clubs'} you
                own will change hands.{' '}
              </>
            )}
            {data.ridesToCancel > 0 && (
              <>
                {data.ridesToCancel} upcoming {data.ridesToCancel === 1 ? 'ride' : 'rides'} you
                organise will be cancelled
                {data.ridersAffected > 0
                  ? `, affecting ${data.ridersAffected} ${data.ridersAffected === 1 ? 'rider' : 'riders'}.`
                  : '.'}
              </>
            )}
          </p>
        )}

        <form action={formAction} className="flex flex-col gap-3">
          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
          />

          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
          {!online && (
            <p className="text-xs font-medium text-muted">
              You’re offline — reconnect to delete your account.
            </p>
          )}

          <Button type="submit" variant="danger" size="md" loading={pending} disabled={!online}>
            Delete account
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
        </form>
      </div>
    </ContextMenu>
  )
}
