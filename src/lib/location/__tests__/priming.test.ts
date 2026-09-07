import { describe, expect, it } from 'vitest'
import { locationPrimingState } from '@/lib/location/priming'
import type { DeviceLocationPermission, RiderLocation } from '@/lib/location/rider-location'

/**
 * `locationPrimingState` — which of five things, if anything, a screen draws
 * to ask a rider where they are (PD-170, PD-419).
 *
 * The whole reason this decision is a pure function rather than a branch
 * inside `UseMyLocationRow` is that it has twelve reachable states and only
 * two of them are things a rendering test could reach. Each case below names
 * the defect it exists to stop, per this repo's convention.
 *
 * **Two of these cases were reversed by PD-419, and both reversals are
 * deliberate rather than regressions to restore.** `priming.ts`'s own
 * PD-419 section carries the argument; the short version is that the old
 * `hidden` answers left two riders with no route to a position at all — the one
 * on a platform with no geolocation, and the one whose town is nowhere near
 * where they are. The old assertions are kept below, inverted, so a revert
 * cannot pass silently.
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

  it('hides on a platform with no geolocation when the rider already has a position', () => {
    // There is no dialog to prime and no setting to send them to, and the
    // distances on screen are already working.
    expect(locationPrimingState({ permission: 'unavailable', position: PROFILE })).toBe('hidden')
  })
})

describe('the town question — PD-419', () => {
  it('asks for a town on a platform with no geolocation and no position', () => {
    // **Reversed by PD-419**, and it was the state with the worst outcome: a
    // rider on a WebView with no geolocation, or behind an MDM that strips it,
    // had no position, no device to ask, and no affordance anywhere saying so.
    // The device story never starts here, so the town IS the offer.
    expect(locationPrimingState({ permission: 'unavailable', position: null })).toBe('town')
  })
})

describe('a rider who already has a position is offered an upgrade, or nothing', () => {
  it.each<DeviceLocationPermission>(['granted', 'denied', 'unavailable'])(
    'hides beside a profile-derived position when there is no better answer to offer (%s)',
    (permission) => {
      // `granted` already resolves to the device when it can; `denied` and
      // `unavailable` have no route to one from inside the app. In all three a
      // control offering the upgrade is a dead end.
      expect(locationPrimingState({ permission, position: PROFILE })).toBe('hidden')
    }
  )

  it('offers refine beside a profile position the device could still improve on', () => {
    // **Reversed by PD-419.** This read `hidden`, on the grounds that a rider
    // with a working position must not be nagged — true of a 56px card offering
    // to enable something, and not of a line saying WHERE the distances on
    // screen are measured from. The rider this exists for has `Utrecht` on
    // their profile and is in Maastricht: every distance is wrong and nothing
    // on the screen said so.
    expect(locationPrimingState({ permission: 'prompt', position: PROFILE })).toBe('refine')
  })

  it.each(EVERY_PERMISSION)(
    'never offers refine beside a DEVICE position (%s)',
    (permission) => {
      // A device fix is the best answer this app has, so there is no upgrade to
      // offer. `denied` beside one is reachable — a fix inside the five-minute
      // memo, and the rider revoking permission in another tab — and the cached
      // answer is still good.
      expect(locationPrimingState({ permission, position: DEVICE })).toBe('hidden')
    }
  )
})

describe('the two states the row was built for', () => {
  it('asks when the device will prompt and the rider has no position at all', () => {
    expect(locationPrimingState({ permission: 'prompt', position: null })).toBe('ask')
  })

  it('reports blocked when the device has already refused and there is no position', () => {
    // The one-way state on iOS. The row still draws — it is the only place
    // that can explain what was lost and where to switch it back on.
    expect(locationPrimingState({ permission: 'denied', position: null })).toBe('blocked')
  })
})
