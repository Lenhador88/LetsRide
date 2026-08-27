'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronRightIcon, LocationFilledIcon } from '@/components/icons/generated'
import { LocationPrimingSheet } from '@/components/location/LocationPrimingSheet'
import { locationPrimingState } from '@/lib/location/priming'
import {
  deviceLocationPermission,
  requestDeviceLocation,
  type DeviceLocationPermission,
  type RiderLocation,
} from '@/lib/location/rider-location'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { cn } from '@/lib/utils'

/**
 * The only control in this app that can reach the device's location permission
 * — PD-170.
 *
 * ## Before this existed, no rider could grant it
 *
 * `resolveRiderLocation()` is deliberately silent: its device source returns
 * early unless the permission ALREADY reads `granted`, so it can be called
 * from an effect on every screen without ever raising a dialog.
 * `requestDeviceLocation()` is the one function that may prompt — and it had
 * no caller anywhere in `src/`. So the three features that measure distance
 * (`/rides`' near-you strip, `/clubs`' explore strip, the place field's search
 * bias) all ran permanently on the geocoded onboarding city, and a rider with
 * no geocodable city got nothing at all, with no affordance anywhere to fix
 * it. This row is that affordance, and the sheet behind it is what makes
 * spending the device's one-shot prompt a deliberate act.
 *
 * ## Geometry is `ExploreClubsStrip`'s, deliberately
 *
 * 56px on `White/100` at radius 8, 16px padding, 12px gap, a 24px `Location
 * Filled` in `Accent Brand/100`, the label at Poppins/14/Semibold, a chevron
 * trailing. It renders in the same slot as the near-you strip on `/rides` and
 * the explore strip on `/clubs`, and the same row in the same place on two
 * tabs should be the same row. A `<button>` rather than a `<Link>`, because it
 * opens a sheet rather than going anywhere — which is why it carries
 * `aria-haspopup="dialog"` and the chevron is the only thing it borrows from
 * the two links.
 *
 * ## When it draws, and when it must not
 *
 * `locationPrimingState` owns that decision and states each rule with the trap
 * it avoids; the short version is that it draws only when the rider has no
 * position at all AND the device has something left to say. **`hidden` is the
 * answer while either input is still undecided**, so this never flashes onto a
 * screen and then vanishes.
 *
 * ## Two things happen on a grant, and both are needed
 *
 * `requestDeviceLocation()` overwrites the module-level memo inside
 * `rider-location.ts`, which is what a LATER `resolveRiderLocation()` call
 * would read — but the screens above already hold a resolved `useQuery` entry
 * on `queryKeys.riderLocation()` and would never call it again. So the cache
 * entry is invalidated too, and the strips recompute against the device fix
 * without a navigation.
 */
export function UseMyLocationRow({
  position,
  className,
}: {
  /**
   * The screen's own `useQuery(queryKeys.riderLocation(), …)` data.
   * **`undefined` is "not settled" and `null` is a decided "nowhere"** — see
   * `locationPrimingState`, which draws nothing for the first and everything
   * for the second.
   */
  position: RiderLocation | null | undefined
  /**
   * Classes for the row's own padded WRAPPER, not the button. The wrapper is
   * this component's rather than the page's for `ExploreRidesStrip`'s reason:
   * the row draws nothing in most states, and padding out in the page would
   * leave 8px of empty space above whatever follows on every one of them.
   * `/clubs` passes `px-0` because its slot is already inside a padded block.
   */
  className?: string
}) {
  const [permission, setPermission] = useState<DeviceLocationPermission | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  // In an effect, never during render: `deviceLocationPermission()` reads
  // `navigator`, and a `'use client'` component is still server-rendered by
  // Next on first load (see `src/lib/supabase/resolve.ts`'s header for why
  // that is permanent). The `cancelled` flag is the ordinary unmount guard —
  // the Permissions API is a promise and this row unmounts on every tab
  // change.
  useEffect(() => {
    let cancelled = false
    void deviceLocationPermission().then((state) => {
      if (!cancelled) setPermission(state)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onContinue = useCallback(async () => {
    setPending(true)
    try {
      const fix = await requestDeviceLocation()

      // Re-read rather than infer. A `null` fix is a denial, a timeout, or a
      // device that simply could not get one, and only the first of those is a
      // permission problem — inferring `denied` from the null would show a
      // rider who is standing in a car park the "you refused us" copy.
      const next = await deviceLocationPermission()
      setPermission(next)

      if (fix) {
        // The screens above hold a resolved cache entry on this key and will
        // never call the resolver again on their own. See the header.
        invalidate(queryKeys.riderLocation())
        setOpen(false)
        return
      }

      // Denied: leave the sheet open and let it re-render as the `blocked`
      // copy, so the explanation of what was just lost lands in the same
      // breath as the refusal rather than on some later screen.
      if (next !== 'denied') setOpen(false)
    } finally {
      setPending(false)
    }
  }, [])

  const state = locationPrimingState({ permission, position })
  if (state === 'hidden') return null

  return (
    <>
      <div className={cn('px-4 pt-2', className)}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex h-14 w-full items-center gap-3 rounded-lg bg-surface px-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:bg-background"
        >
          <LocationFilledIcon className="h-6 w-6 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {state === 'ask' ? 'Use my location' : 'Location is switched off'}
          </span>
          <ChevronRightIcon className="h-6 w-6 shrink-0 text-muted" />
        </button>
      </div>

      <LocationPrimingSheet
        open={open}
        mode={state}
        pending={pending}
        onContinue={() => void onContinue()}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
