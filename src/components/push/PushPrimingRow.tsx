'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronRightIcon, MailboxIcon } from '@/components/icons/generated'
import { PushPrimingSheet } from '@/components/push/PushPrimingSheet'
import { pushPrimingState, type PushPermission } from '@/lib/push/priming'
import {
  checkPushPermission,
  isPushCapable,
  onProviderToken,
  registerCurrentDevice,
  requestProviderRegistration,
  requestPushPermission,
} from '@/lib/push/registration'
import { cn } from '@/lib/utils'

/**
 * The only control in this app that can reach the device's notification
 * permission — PD-431, child B task 2.9 of `deliver-push-notifications`.
 *
 * ## It draws on `/notifications` and nowhere else
 *
 * That is task 2.9's decision and it is narrower than the location row's, which
 * draws on three screens. The reason is the one-shot dialog: the more places an
 * ask appears, the more likely a rider dismisses it reflexively, and iOS gives
 * no second chance. `/notifications` is the one screen where a rider is already
 * thinking about being told things, so the offer is in context rather than
 * interruptive.
 *
 * **There is deliberately no automatic ask.** `UseMyLocationRow` has one, on a
 * timer, for the Explore screens; this row has none and must not grow one. A
 * sheet that opens itself is how the one dialog gets spent by a rider who was
 * scrolling.
 *
 * ## What renders on the web: nothing
 *
 * `pushPrimingState` returns `hidden` before it reads a permission unless
 * `Capacitor.isNativePlatform()`, so on `app.letsride.social` and
 * `app-dev.letsride.social` this component draws nothing and reaches no plugin.
 * That is what makes it safe to merge ahead of the sender — `registration.ts`'s
 * header has the full ordering argument.
 *
 * ## `stalled` is a diagnosis, not an offer
 *
 * Permission granted, registration requested, no token. It means the build is
 * misprovisioned — no `aps-environment` entitlement, a bundle id that does not
 * match the profile, a missing `google-services.json` — and it is the state
 * that would otherwise be invisible, because the rider granted permission and
 * everything looks correct. The row says so plainly rather than offering a
 * button, since nothing a rider can do fixes it.
 */
export function PushPrimingRow({ className }: { className?: string }) {
  const [permission, setPermission] = useState<PushPermission | undefined>(undefined)
  const [hasToken, setHasToken] = useState<boolean | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  // In an effect, never during render — `checkPushPermission()` reaches the
  // Capacitor bridge, and a `'use client'` component is still server-rendered
  // by Next on first load. `src/lib/supabase/resolve.ts`'s header carries why
  // that rule is permanent even once the SSR shell is retired.
  useEffect(() => {
    let cancelled = false
    void checkPushPermission().then((state) => {
      if (!cancelled) setPermission(state)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The provider's answer. Subscribed whenever permission is granted — not only
  // after a tap — because a token also arrives on the cold-start registration
  // that `registerOnBoot` performs, and this row is what reports its absence.
  useEffect(() => {
    if (permission !== 'granted') return

    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void onProviderToken(
      (token) => {
        if (cancelled) return
        setHasToken(true)
        void registerCurrentDevice(token).catch(() => {
          // The row's job is the permission, not the write. A failed RPC leaves
          // the device unregistered and the next cold start retries it
          // unconditionally, which is the repair `078` §5 relies on.
        })
      },
      () => {
        if (!cancelled) setHasToken(false)
      },
    ).then((off) => {
      if (cancelled) off()
      else unsubscribe = off
    })

    // Asking again is safe and is what makes `stalled` reachable: without a
    // request there is no event either way, and "no token" would be
    // indistinguishable from "never asked".
    void requestProviderRegistration().catch(() => {
      if (!cancelled) setHasToken(false)
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [permission])

  const state = pushPrimingState({ isNative: isPushCapable(), permission, hasToken })

  const onContinue = useCallback(() => {
    setPending(true)
    void requestPushPermission()
      .then((next) => {
        setPermission(next)
        // Only close on an answer. A rider who backgrounds the app mid-dialog
        // comes back to the sheet still open, which is the honest state.
        if (next !== undefined) setOpen(false)
      })
      .finally(() => setPending(false))
  }, [])

  if (state === 'hidden') return null

  if (state === 'stalled') {
    return (
      <div className={cn('px-4 py-2', className)}>
        <p className="text-sm font-medium text-muted">
          Notifications are allowed, but this device has not been able to register for them. This
          is a problem with the app rather than with your settings.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('px-4 py-2', className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left"
      >
        <MailboxIcon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold text-foreground">
          {state === 'ask' ? 'Never miss a ride' : 'Notifications are switched off'}
        </span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      </button>

      <PushPrimingSheet
        open={open}
        mode={state === 'blocked' ? 'blocked' : 'ask'}
        pending={pending}
        onContinue={onContinue}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
