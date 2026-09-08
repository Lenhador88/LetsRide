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
 * That is task 2.9's decision. The reason is the one-shot dialog: the more
 * places an ask appears, the more likely a rider dismisses it reflexively, and
 * iOS gives no second chance. `/notifications` is the one screen where a rider
 * is already thinking about being told things, so the offer is in context
 * rather than interruptive.
 *
 * **There is deliberately no automatic ask, and since PD-447 that is the app's
 * posture rather than this row's alone.** `LocationQuestionRow` had one, on a
 * timer, for the Explore screens; it was removed, so no sheet in this app opens
 * without a rider gesture. This row never had one and must not grow one — a
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
 * ## `stalled` is a diagnosis, not an offer — and it does not name a cause
 *
 * Permission granted, and no usable registration. **Two different things reach
 * it**, which is why the copy says what is true of both rather than what is
 * true of one:
 *
 * - the build is misprovisioned — no `aps-environment` entitlement, a bundle id
 *   that does not match the profile, a missing `google-services.json` — so the
 *   provider never answers at all;
 * - or the provider answered and `register_push_device` refused the write, most
 *   often because the rider is on a bad connection.
 *
 * Nothing here can tell them apart, and the second is far more common, so copy
 * blaming the app would be wrong most of the times it is shown. What they share
 * is that it is not the rider's settings and that it retries by itself. The row
 * offers no button because nothing a rider can do fixes either one.
 *
 * The state earns its place because it is otherwise invisible: the rider
 * granted permission, every screen looks correct, and no notification will ever
 * arrive.
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
          // **A failed write puts the row back into `stalled`, and that is the
          // point rather than tidiness.** A provider token that arrived but was
          // refused by `register_push_device` — a malformed or oversized token,
          // which `push_devices`' CHECKs reject — leaves a device that will
          // never receive anything. Leaving `hasToken` true reads `hidden`,
          // which is indistinguishable from a device that is fully set up.
          // The next cold start still retries unconditionally, which is the
          // repair `078` §5 relies on; this only stops the screen claiming
          // success in the meantime.
          if (!cancelled) setHasToken(false)
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
        {/* Names no cause — see the header's `stalled` section for why. */}
        <p className="text-sm font-medium text-muted">
          Notifications are allowed, but this device is not registered for them yet. Nothing to fix
          on your side — it will try again next time you open the app.
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
