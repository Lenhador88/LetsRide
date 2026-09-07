import { localityOf } from '@/lib/countries'
import type { DeviceLocationPermission, RiderLocation } from '@/lib/location/rider-location'

/**
 * What the profile's location setting says — PD-419.
 *
 * ## A pure function, for `locationPrimingState`'s reason
 *
 * Six reachable states, of which one is a rendering question. Split out, every
 * state gets a named test and the two that a static render cannot distinguish —
 * *device fix, permission granted* and *device fix, permission since revoked* —
 * are directly assertable. Folded into the component, only the branches a
 * `renderToStaticMarkup` pass happens to reach would be covered.
 *
 * ## The three sources the decision obliges
 *
 * The 2026-09-06 decision names them: **device**, **you told us**, and
 * **none** — and requires all three to be nameable on screen, because a rider
 * cannot withdraw what they cannot see. This maps `RiderLocation.source`
 * (`'device' | 'profile'`) onto the first two and a null position onto the
 * third.
 *
 * **`canRemove` is about the TOWN alone, and that is not the same question as
 * "is there a position".** A device fix is read live and never stored, so there
 * is nothing to remove; the copy points at the OS settings instead. A rider can
 * simultaneously have a device fix in use AND a stored town underneath it — the
 * chain prefers the device — and that rider must still be able to remove the
 * town, which is why this reads `town` rather than `position.source`.
 */
export type RiderLocationSetting = {
  heading: string
  detail: string
  /** Whether a stored town exists to clear. See the header — NOT "is there a
   *  position". */
  canRemove: boolean
}

export function describeRiderLocation({
  position,
  town,
  permission,
}: {
  /** `null` is a decided "nowhere". Callers gate on settledness before
   *  calling — there is no `undefined` state to describe. */
  position: RiderLocation | null
  /** `profiles.location`, raw. Reduced with `localityOf` here rather than by
   *  the caller, so the free-text forms riders actually type — `Amsterdam`,
   *  `Amsterdam, Netherlands`, `Amsterdam, NL` — all render as one word. */
  town: string | null
  /** `undefined` until the Permissions API answers. The copy must not claim a
   *  device state it has not read. */
  permission: DeviceLocationPermission | undefined
}): RiderLocationSetting {
  const locality = localityOf(town)
  const canRemove = locality !== null

  if (position?.source === 'device') {
    return {
      heading: 'Using your device location',
      detail: canRemove
        ? `Your device is more precise, so we measure from there rather than from ${locality}. To stop sharing it, turn location off for LetsRide in your device settings.`
        : 'To stop sharing it, turn location off for LetsRide in your device settings.',
      canRemove,
    }
  }

  if (position?.source === 'profile') {
    // The position came from the town, so a town exists — but `localityOf` may
    // still decline to shorten it (a string the geocoder resolved and this
    // helper will not reduce). `nearLabel` hits the same case and answers `you`;
    // here the honest thing is to name the raw column, since this screen is
    // where the rider goes to check exactly what is stored.
    const shown = locality ?? town
    return {
      heading: `Using the town you told us: ${shown}`,
      detail:
        'Rides and clubs are measured from here. Turn on device location for a more precise answer, or remove it to stop measuring distances at all.',
      canRemove: true,
    }
  }

  // No position. Three genuinely different reasons, and the rider can act on
  // only two of them — so the copy has to tell them apart rather than saying
  // "no location" three times.
  if (permission === 'denied') {
    return {
      heading: 'No location set',
      detail: canRemove
        ? `Location is switched off for LetsRide, and we could not place ${locality}. Try another town, or turn location back on in your device settings.`
        : 'Location is switched off for LetsRide. Tell us your town instead, or turn it back on in your device settings.',
      canRemove,
    }
  }

  return {
    heading: 'No location set',
    detail: canRemove
      ? `We could not place ${locality} on the map. Try another town, or turn on device location.`
      : 'Rides and clubs near you are not measured. Tell us your town, or turn on device location.',
    canRemove,
  }
}
