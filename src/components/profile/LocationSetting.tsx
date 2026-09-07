'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TownQuestionSheet } from '@/components/location/TownQuestionSheet'
import { setRiderTown } from '@/lib/actions/profile'
import { getMyLocationText } from '@/lib/data/profile'
import {
  deviceLocationPermission,
  resolveRiderLocation,
  type DeviceLocationPermission,
} from '@/lib/location/rider-location'
import { describeRiderLocation } from '@/lib/location/setting'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * Where the app thinks this rider is, where that came from, and how to change
 * or remove it — PD-419.
 *
 * ## Withdrawal is the obligation, not the feature
 *
 * The 2026-09-06 decision is explicit that *no position at all* is a supported
 * state rather than a degraded one, and that **clearing back to none has to
 * work**. That is the whole reason this section exists rather than a plain
 * location field on `EditProfileForm` being considered sufficient: a field says
 * what the rider typed, and this says what the app is actually *using* — which
 * are different the moment a device fix outranks the town, and a rider with no
 * way to see which one is in play has no way to know what they are withdrawing.
 *
 * **PD-425 removed that field**, so this is now the only location control on the
 * screen and `setRiderTown` the column's only writer. The two shipped side by
 * side under the same heading for a day: the field accepted any string, and this
 * section then told the rider it could not be placed. What is load-bearing here
 * is that this control **requires a pick** — `TownQuestionSheet` gates Save on
 * one — which is the property the free-text field could not have.
 *
 * ## What it can and cannot clear, stated on screen
 *
 * `Remove` clears `profiles.location`. It cannot revoke the device permission —
 * no web API does, and the Capacitor plugin that opens the OS settings app is
 * not installed — so when the position in use is the device's, the copy says
 * where to go instead of offering a control that does nothing. That is the same
 * rule `LocationPrimingSheet`'s `blocked` branch already follows.
 *
 * ## Reads, never a prompt
 *
 * `resolveRiderLocation()` is the silent resolver: its device source answers
 * only where permission is ALREADY granted. Opening the settings screen must
 * not raise an OS dialog, so nothing here calls `requestDeviceLocation` — the
 * one control that may prompt stays `UseMyLocationRow`'s, which is reached from
 * a screen that explains why.
 */
export function LocationSetting() {
  const position = useQuery(queryKeys.riderLocation(), resolveRiderLocation)
  const town = useQuery(queryKeys.profile.location(), getMyLocationText)
  const [permission, setPermission] = useState<DeviceLocationPermission | undefined>(undefined)
  const [asking, setAsking] = useState(false)
  const [clearing, startClearing] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // In an effect, never during render — `navigator` does not exist in the
  // prerender pass. Same guard as `UseMyLocationRow`'s.
  useEffect(() => {
    let cancelled = false
    void deviceLocationPermission().then((state) => {
      if (!cancelled) setPermission(state)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Gate on the DATA, never on `isLoading` — `useQuery` starts its fetch in an
  // effect, so the first render has neither data nor a fetch in flight.
  // `position.data` is `RiderLocation | null` once settled and `undefined`
  // before, which is exactly the distinction `describeRiderLocation` takes.
  const settled = position.data !== undefined || !!position.error
  if (!settled || town.data === undefined) return null

  const described = describeRiderLocation({
    position: position.data ?? null,
    town: town.data,
    permission,
  })

  function clear() {
    setError(null)
    startClearing(async () => {
      const result = await setRiderTown(null)
      if (result.error) setError(result.error)
    })
  }

  return (
    <section className="mt-6">
      <SectionHeader title="Where you ride from" />

      <div className="flex flex-col gap-3 px-6 pt-2">
        <p className="text-sm font-semibold text-foreground">{described.heading}</p>
        <p className="text-sm font-medium text-muted">{described.detail}</p>

        <p role="status" aria-live="polite" className="text-sm text-danger empty:hidden">
          {error}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAsking(true)}>
            {described.canRemove ? 'Change town' : 'Set your town'}
          </Button>
          {/* Only where there is something of the rider's OWN to remove. A
              device fix is not stored by this app at all — it is read live and
              held in a five-minute memo — so a `Remove` beside it would promise
              a deletion of something that was never written down. */}
          {described.canRemove && (
            <Button variant="danger" onClick={clear} loading={clearing}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <TownQuestionSheet
        open={asking}
        onClose={() => setAsking(false)}
        onSaved={() => setAsking(false)}
      />
    </section>
  )
}
