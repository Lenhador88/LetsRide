import { describe, expect, it } from 'vitest'
import { locationPrimingState } from '@/lib/location/priming'
import type { DeviceLocationPermission, RiderLocation } from '@/lib/location/rider-location'

/**
 * `locationPrimingState` — which of three things, if anything, a screen draws
 * to ask for the device location (PD-170).
 *
 * The whole reason this decision is a pure function rather than a branch
 * inside `UseMyLocationRow` is that it has twelve reachable states and only
 * two of them are things a rendering test could reach. Each case below names
 * the defect it exists to stop, per this repo's convention.
 */

const DEVICE: RiderLocation = { lat: 52.09, lon: 5.12, source: 'device' }
const PROFILE: RiderLocation = { lat: 52.09, lon: 5.12, source: 'profile' }

const EVERY_PERMISSION: DeviceLocationPermission[] = ['granted', 'prompt', 'denied', 'unavailable']

describe('nothing is drawn against an undecided input', () => {
  it.each(EVERY_PERMISSION)(
    'hides while the position is still resolving, whatever the permission says (%s)',
    (permission) => {
      // The defect: the row flashes onto every load and vanishes when the
      // position lands a beat later.
      expect(locationPrimingState({ permission, position: undefined })).toBe('hidden')
    }
  )

  it.each([[null], [DEVICE], [PROFILE]])(
    'hides while the permission is still unread, whatever the position says (%o)',
    (position) => {
      // The defect: a rider who granted location months ago watches an offer
      // to enable it appear and disappear on every screen.
      expect(locationPrimingState({ permission: undefined, position })).toBe('hidden')
    }
  )
})

describe('states with nothing left to ask for', () => {
  it('hides when the permission is already granted and a fix arrived', () => {
    expect(locationPrimingState({ permission: 'granted', position: DEVICE })).toBe('hidden')
  })

  it('hides when the permission is granted but no fix came back', () => {
    // A granted permission with a null position is a GPS acquisition that
    // failed or timed out. A permission sheet is the wrong answer to it, and
    // offering one would put a row on the screen that cannot fix anything.
    expect(locationPrimingState({ permission: 'granted', position: null })).toBe('hidden')
  })

  it('hides on a platform with no geolocation at all', () => {
    // There is no dialog to prime and no setting to send the rider to.
    expect(locationPrimingState({ permission: 'unavailable', position: null })).toBe('hidden')
  })
})

describe('a rider who already has a position is never nagged', () => {
  it.each(EVERY_PERMISSION)('hides beside a profile-derived position (%s)', (permission) => {
    // The near-you strip and the club distances are working — approximately,
    // from the geocoded onboarding city. A second location row on a screen
    // that already has one is noise, permanently, for precision nobody asked
    // for. Documented as a deliberate cost in `priming.ts`.
    expect(locationPrimingState({ permission, position: PROFILE })).toBe('hidden')
  })

  it('hides beside a device position even when the permission reads denied', () => {
    // Reachable: a fix inside the five-minute memo, and the rider revoking
    // permission in another tab. The cached answer is still good.
    expect(locationPrimingState({ permission: 'denied', position: DEVICE })).toBe('hidden')
  })
})

describe('the two states the row exists for', () => {
  it('asks when the device will prompt and the rider has no position at all', () => {
    expect(locationPrimingState({ permission: 'prompt', position: null })).toBe('ask')
  })

  it('reports blocked when the device has already refused and there is no position', () => {
    // The one-way state on iOS. The row still draws — it is the only place
    // that can explain what was lost and where to switch it back on.
    expect(locationPrimingState({ permission: 'denied', position: null })).toBe('blocked')
  })
})
