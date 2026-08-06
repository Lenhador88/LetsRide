'use client'

import { useState } from 'react'
import { LogOutIcon, OptionsIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { useSignOut } from '@/lib/actions/navigate'

/**
 * The header's overflow control and its sheet — `Profile / Delete account /
 * Account options` (`2303:8097`).
 *
 * The sheet has **exactly two rows** in the design, and that is read from the
 * frame rather than assumed: `Sign out` and `Delete account`. Only the first is
 * built. Deleting an account is not a row to add lightly — it needs the auth
 * admin API or an RPC, a confirmation screen the design does draw
 * (`Confirm account deletion`, `2303:9370`), and a decision about what happens
 * to the rider's postcards, rides and club memberships. It is omitted rather
 * than offered as a dead row, the same treatment Journal got on the ride
 * detail, and logged in docs/FIGMA-FIDELITY-TODO.md §Profile.
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
