'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LocationFilledIcon } from '@/components/icons/generated'
import { Button } from '@/components/ui/Button'
import { toPlaceValue, type PlaceValue } from '@/components/ui/PlaceSearchField'
import { reverseGeocodePlace } from '@/lib/data/places'
import { clearDismissal } from '@/lib/location/dismissal'
import {
  deviceLocationPermission,
  requestDeviceLocation,
  type DeviceLocationPermission,
} from '@/lib/location/rider-location'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { LOCATION_MAX_LENGTH } from '@/lib/validation/profile'

/**
 * How long the control waits before it gives the rider their field back.
 *
 * **It releases the control; it does not cancel the lookup.** The OS dialog is
 * modal and a rider may read it for as long as they like, so a ceiling that
 * discarded the answer would throw away the fix of anyone slower than it. Past
 * 20 s the control returns to idle with the status line, and a fix that lands
 * later is still handed over — unless the rider has touched the field since.
 * What it guards against is a WebView shim that never calls back at all:
 * `requestDeviceLocation` arms no backstop while the dialog may be up.
 */
export const TOWN_FROM_DEVICE_CEILING_MS = 20_000

export const TOWN_FROM_DEVICE_MISSED = "We couldn't find your town. Type it instead."

type Outcome = { place: PlaceValue } | { missed: true } | { declined: true }

async function findTown(): Promise<Outcome> {
  const fix = await requestDeviceLocation()
  if (!fix) {
    // Only a permission that still reads `granted` proves this was a missing
    // fix rather than a refusal. `deviceLocationPermission()` folds an
    // unsupported Permissions API into `prompt`, and `getPositionOnce` turns a
    // denial into the same `null`, so on such a WebView a denial reads exactly
    // like a dismissed dialog — and either way nothing may invite a retry iOS
    // will never honour.
    return (await deviceLocationPermission()) === 'granted' ? { missed: true } : { declined: true }
  }
  // `LocationQuestionRow`'s three things on a grant, for the same reasons: the
  // resolver's memo already moved, so a screen holding the key (the profile's
  // `LocationSetting`, under the sheet) must re-read; and a grant clears the
  // Explore row's dismissal record outright (`rider-position-question`).
  invalidate(queryKeys.riderLocation())
  clearDismissal()
  const found = await reverseGeocodePlace(fix.lat, fix.lon)
  return found ? { place: toPlaceValue(found, LOCATION_MAX_LENGTH) } : { missed: true }
}

/**
 * The town question's *Use my current location* — PD-477.
 *
 * Wraps the town field (`children`) and draws a secondary control under it, in
 * both places a town is asked: the onboarding town step and
 * `TownQuestionSheet`. A tap asks the OS for one fix, names the town through
 * `search-places`' reverse mode, and hands it to `onFound` as the same
 * `PlaceValue` a typed pick would be. **It writes nothing** — the pick stays
 * editable, and Continue or Save stays the rider's.
 *
 * **Tap-only, never on mount** (`rider-position-question`): the permission is
 * READ in an effect, and the request runs from the click handler.
 * `request-callers.test.ts` holds the requesting API to two callers.
 *
 * - `prompt` / `granted` draw the control; `denied`, `unavailable` and
 *   not-yet-read draw nothing. A tap that ends in no fix while the permission
 *   does not read `granted` hides it for good and says nothing — iOS shows the
 *   dialog once per install, so nothing may suggest a retry.
 * - A granted tap with no fix, no name, or past the ceiling → the control
 *   returns to idle with one muted status line. A tap that silently does
 *   nothing reads as broken; an error colour reads as the rider's fault.
 * - **A late answer never lands on the rider's own.** The wrapper counts every
 *   interaction with the field; if there was one since the tap, the answer is
 *   dropped — the composer's *re-checked at landing* rule.
 */
export function TownFromDevice({
  children,
  onFound,
  disabled,
}: {
  children: ReactNode
  onFound: (place: PlaceValue) => void
  disabled?: boolean
}) {
  const [permission, setPermission] = useState<DeviceLocationPermission | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [missed, setMissed] = useState(false)
  const touched = useRef(0)
  const attempts = useRef(0)
  const mounted = useRef(true)

  // In an effect, never during render — `navigator` does not exist in the
  // prerender pass.
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    void deviceLocationPermission().then((state) => {
      if (!cancelled) setPermission(state)
    })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [])

  const offered = permission === 'prompt' || permission === 'granted'

  async function locate() {
    const attempt = ++attempts.current
    const touchedAtTap = touched.current
    setPending(true)
    setMissed(false)

    const release = setTimeout(() => {
      if (!mounted.current || attempts.current !== attempt) return
      setPending(false)
      setMissed(true)
    }, TOWN_FROM_DEVICE_CEILING_MS)

    const outcome = await findTown()
    clearTimeout(release)
    if (!mounted.current || attempts.current !== attempt) return
    setPending(false)

    if ('declined' in outcome) setPermission('denied')
    else if ('missed' in outcome) setMissed(true)
    else if (touched.current === touchedAtTap) {
      setMissed(false)
      onFound(outcome.place)
    }
  }

  const touch = () => {
    touched.current += 1
  }

  return (
    <div className="flex flex-col gap-3">
      <div onInputCapture={touch} onPointerDownCapture={touch} onKeyDownCapture={touch}>
        {children}
      </div>
      {offered && (
        <>
          {/* `type="button"`: on the onboarding step this sits inside the
              step's `<form>`, and a bare `<button>` submits it. */}
          <Button
            type="button"
            variant="secondary"
            onClick={locate}
            loading={pending}
            disabled={disabled}
          >
            {!pending && <LocationFilledIcon className="h-4 w-4 text-accent" aria-hidden="true" />}
            Use my current location
          </Button>
          {/* Mounted before its content, or a screen reader announces nothing. */}
          <p role="status" aria-live="polite" className="text-sm font-medium text-muted empty:hidden">
            {missed ? TOWN_FROM_DEVICE_MISSED : ''}
          </p>
        </>
      )}
    </div>
  )
}
