'use client'

import { useState } from 'react'
import { LogOutIcon, OptionsIcon, TrashIcon } from '@/components/icons/generated'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { DeleteAccountSheet } from '@/components/profile/DeleteAccountSheet'
import { accountDeletionEnabled } from '@/lib/flags'
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
 * **The deployed Edge Function does not yet enforce the password
 * `DeleteAccountSheet` collects, and this row is gated behind
 * `accountDeletionEnabled()` (`src/lib/flags.ts`) for exactly that reason —
 * reviewer finding #1, 2026-08-16.** Committing the function ahead of the
 * client inside one branch does not make a redeploy fail-closed: both merge
 * together, the client half auto-deploys, the function half deploys by hand
 * later if at all. Without the flag, merging this PR puts a live "Delete
 * account" affordance on `/profile` whose password is checked by nothing —
 * three taps and one character destroys the account. The flag defaults off
 * (unset, or anything but the literal string `'true'`); the owner sets it per
 * project only after confirming that project's redeploy enforces the proof by
 * content, never by a changed `ezbr_sha256` alone.
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
  // Called per render rather than cached at module scope. `flags.ts` reads
  // `process.env` directly rather than caching its own result, and Next
  // inlines `NEXT_PUBLIC_*` at build time either way — so there is no
  // runtime cost or behaviour this saves; it just keeps this component free
  // of a second copy of the flag's state to fall out of sync with the one
  // `accountDeletionEnabled` already owns. (`flags.test.ts` covers the
  // predicate itself; this repo has no component-render test harness, so
  // there is no test exercising this call site — noted rather than claimed,
  // per reviewer finding #2.)
  const deletionEnabled = accountDeletionEnabled()

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
            Absent entirely — not disabled, not a dead row — while the flag is
            off, per this file's own "either work or not be drawn" rule: a
            visible-but-broken control is worse than an absent one, and here
            "broken" means "irreversible with no gate behind it". */}
        {deletionEnabled && (
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
        )}
      </ContextMenu>

      {/* Not mounted at all while the flag is off — `deleting` can only ever
          become true via the row above, but this is the belt to that
          braces: nothing can open a sheet that was never rendered. */}
      {deletionEnabled && (
        <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
      )}
    </>
  )
}
