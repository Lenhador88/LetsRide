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
 * **`Delete account` renders unconditionally, and the flag that used to hide
 * it is gone (2026-08-19).** `accountDeletionEnabled()` and `src/lib/flags.ts`
 * were deleted with this change; nothing replaces them. The gate went up on
 * 2026-08-16 for one reason — the deployed Edge Function enforced no password
 * at the time, so the sheet's field gated nothing and merging the flow would
 * have put an irreversible affordance in front of a function checking nothing.
 * That reason is spent: the owner redeployed 2026-08-17 and the build was
 * verified by CONTENT on 2026-08-19, seven cases, including a real non-empty
 * wrong password answering `reauth_required`
 * (`openspec/changes/add-account-deletion/tasks.md` §2.6). A flag whose
 * premise is false is not a safety margin, it is a switch nobody can reason
 * about — and this one had a second cost: it made the browser path
 * untestable, because no rider or walk could reach the sheet to exercise
 * `functions.invoke` and its preflight (task 6.3). Removing it is what lets
 * that run.
 *
 * **What still gates the destructive call is the function, which is where a
 * gate belongs.** It refuses on a missing or wrong password before anything is
 * transferred, swept or deleted, under `verify_jwt`, taking its subject from
 * the JWT and never from the body. A client-side flag never protected that
 * endpoint anyway — it is live and any signed-in rider's own access token
 * already reaches it.
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

        {/* Its own list group, matching the frame's separation from Sign out. */}
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
