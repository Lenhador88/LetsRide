'use client'

import { useState } from 'react'
import { LogOutIcon, OptionsIcon, TrashIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { DeleteAccountSheet } from '@/components/profile/DeleteAccountSheet'
import { useSignOut } from '@/lib/actions/navigate'

/**
 * The header's overflow control and its sheet — `Profile / Delete account /
 * Account options` (`2303:8097`).
 *
 * The sheet has **three rows** in the design: `Preferences`, `Sign out` and
 * `Delete account` (`Warning/100`, `Element / Icon / Trash`). **Two of three
 * are built.** Verified with
 * `npm run figma -- tree "Profile / Delete account / Account options" --all`,
 * where the hidden nodes are the header's back button and an unused button
 * container, and none of the three list items — recorded here because an
 * earlier revision of this comment claimed "exactly two rows … read from the
 * frame" and was wrong, which is the most expensive kind of wrong claim: it
 * names its own method and still reads as verification to the next person.
 *
 * **`Preferences` is deliberately still not built, and that is a decision
 * rather than an oversight left for later.** There is no `/profile/preferences`
 * screen and nothing in this app's scope draws one — CLAUDE.md §Product Scope
 * names no such capability. A row that links nowhere is the dead-row failure
 * this file's own rule refuses ("either work or not be drawn"), so it is
 * omitted until a screen exists for it to open, the same treatment `Delete
 * account` had until this change.
 *
 * **`Delete account` (PD-102) is now built**, in its own list group below
 * `Sign out` per the frame, `Warning/100` with `TrashIcon`. It does **not**
 * navigate — `npm run figma -- tree "Confirm account deletion" --all` shows
 * `Context Menu / Confirm account deletion` (`2303:9370`) sitting as a second
 * sheet over the SAME `/profile` canvas as this one, not a route of its own,
 * the same shape `Content / Context Menu / Postcard` uses. So this row swaps
 * one `ContextMenu` for another — `DeleteAccountSheet` — rather than opening
 * `/profile/delete`, which does not exist. Its groundwork: `029`/`031` make
 * the club-ownership transfer reachable so the cascade does not destroy other
 * riders' postcards, and `supabase/functions/delete-account/` owns the
 * auth-row delete.
 *
 * **This row was gated behind a build-time flag until 2026-08-19, and the
 * flag is gone because the thing it was protecting against is.** When the gate
 * went up the deployed Edge Function enforced no password at all (reviewer
 * finding #1, 2026-08-16): committing the function ahead of the client inside
 * one branch does not make a redeploy fail-closed, since both merge together,
 * the client half auto-deploys and the function half deploys by hand later if
 * at all. Without the flag that merge would have put a live "Delete account"
 * affordance on `/profile` whose password was checked by nothing.
 *
 * **The function enforces it now, measured against the deployed build rather
 * than inferred.** 2026-08-19, all three arms end to end on DEV: no password
 * and a real non-empty wrong password both answer `reauth_required`, and the
 * correct password answers `{"deleted": true}` and the account is gone.
 * `openspec/changes/add-account-deletion/tasks.md` §2.6 carries the table.
 *
 * **What is still NOT exercised is the browser half, and removing the flag is
 * what makes exercising it possible.** Every one of those probes ran through
 * `curl`, which needs no CORS preflight, and the sheet below has never run in
 * a real browser because the row never rendered anywhere. The preflight itself
 * answers 204 with the right allow-headers — necessary, not sufficient. Task
 * 6.3 is that walk, and it was unreachable while the flag existed: a gate
 * nothing can turn on is a gate that also blocks its own testing, which is why
 * the product owner called it (2026-08-19) and why it is recorded here rather
 * than argued again.
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
  const [deleting, setDeleting] = useState(false)
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

        {/* Its own list group, matching the frame's separation from Sign out.
            Drawn unconditionally since the flag came out. This file's "either
            work or not be drawn" rule is unchanged and is now satisfied by the
            function enforcing the password rather than by hiding the row. */}
        <div className="mt-2 border-t border-border pt-2">
          <ContextMenuItem
            variant="warning"
            onClick={() => {
              // Close this sheet before opening the next — both render
              // through the same fixed z-index stack, and ContextMenu's own
              // focus trap assumes it is the only one mounted open at once.
              setOpen(false)
              setDeleting(true)
            }}
          >
            <span className="flex items-center gap-2">
              <TrashIcon className="h-6 w-6" />
              Delete account
            </span>
          </ContextMenuItem>
        </div>
      </ContextMenu>

      <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
    </>
  )
}
