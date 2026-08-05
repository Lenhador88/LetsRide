'use client'

import { useState, useTransition } from 'react'
import { LogOutIcon, OptionsIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { signOut } from '@/lib/actions/auth'

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
 * Sign out goes through the **server action**, not `supabase.auth.signOut()` in
 * the browser as the v1 button did. Signing out is a cookie operation, and
 * CLAUDE.md puts those in actions for that reason: the client call leaves the
 * server's copy of the session cookie to be reconciled on the next request,
 * which is the shape of bug that logs you back in on a refresh.
 */
export function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

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
        <ContextMenuItem
          onClick={() => startTransition(() => void signOut())}
          disabled={pending}
        >
          <span className="flex items-center gap-2">
            <LogOutIcon className="h-6 w-6" />
            {pending ? 'Signing out…' : 'Sign out'}
          </span>
        </ContextMenuItem>
      </ContextMenu>
    </>
  )
}
