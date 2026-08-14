'use client'

import { useState } from 'react'
import { LogOutIcon, OptionsIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { useSignOut } from '@/lib/actions/navigate'

/**
 * The header's overflow control and its sheet — `Profile / Delete account /
 * Account options` (`2303:8097`).
 *
 * The sheet has **three rows** in the design: `Preferences`, `Sign out` and
 * `Delete account` (`Warning/100`, `Element / Icon / Trash`). Only the middle
 * one is built.
 *
 * This comment said "exactly two rows … read from the frame rather than assumed"
 * until 2026-08-06, and it was wrong — verified with
 * `npm run figma -- tree "Profile / Delete account / Account options" --all`,
 * where the hidden nodes are the header's back button and an unused button
 * container, and none of the three list items. **A claim that names its own
 * method and is still wrong is the most expensive kind**, because the method
 * reads as verification and nobody rechecks it.
 *
 * `Delete account` is omitted rather than offered as a dead row, the same
 * treatment Journal got on the ride detail. Its groundwork is in: 029 transfers
 * a departing rider's clubs so the cascade does not destroy other riders'
 * postcards, 031 makes that reachable, and the Edge Function that owns the auth
 * delete is at supabase/functions/delete-account/.
 *
 * The function is deployed and ACTIVE on both projects — check with
 * list_edge_functions rather than reading a date here. **What is still missing
 * is the reason no row points at it yet**: Q7 was answered on
 * 2026-08-14 with "require the password", and the deployed build has no arm to
 * verify one. A row added before that lands is a delete with no gate behind a
 * screen that shows a password field. See openspec/changes/add-account-deletion/
 * group 3, and PD-102 for the ordering.
 *
 * Sign out goes through `lib/actions/auth.ts`, not a bare
 * `supabase.auth.signOut()` as the v1 button did — and that stays true now that
 * the action runs in the browser too. What the action owns is everything
 * *besides* the revocation: destroying the query cache so the next rider on a
 * shared device inherits nothing, and falling back to a local sign-out when the
 * network call fails, so pressing this always leaves the rider signed out. A
 * bare client call does none of that. See `signOut` and `useSignOut`.
 */
export function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const { signOut, pending } = useSignOut()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Account options"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-6 w-6" />
      </button>

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Account options">
        <ContextMenuItem onClick={signOut} disabled={pending}>
          <span className="flex items-center gap-2">
            <LogOutIcon className="h-6 w-6" />
            {pending ? 'Signing out…' : 'Sign out'}
          </span>
        </ContextMenuItem>
      </ContextMenu>
    </>
  )
}
