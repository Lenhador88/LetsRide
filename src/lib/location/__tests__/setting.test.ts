import { describe, expect, it } from 'vitest'
import { describeRiderLocation } from '@/lib/location/setting'
import type { DeviceLocationPermission, RiderLocation } from '@/lib/location/rider-location'

/**
 * `describeRiderLocation` — what the profile's location setting says, and
 * whether there is anything to remove (PD-419).
 *
 * **The obligation under test is withdrawal.** The 2026-09-06 decision requires
 * that *no position at all* is a supported state, that the setting names which
 * of the three sources is in use, and that clearing back to none works. Two of
 * those are copy and one is `canRemove`, and only the third can be got wrong in
 * a way no screenshot shows.
 *
 * Verified both ways per CLAUDE.md §Working Principles: keying `canRemove` off
 * the position instead of the town fails *a device fix over a stored town*;
 * dropping `localityOf` fails the free-text cases.
 */

const DEVICE: RiderLocation = { lat: 52.09, lon: 5.12, source: 'device' }
const PROFILE: RiderLocation = { lat: 52.09, lon: 5.12, source: 'profile' }

const EVERY_PERMISSION: Array<DeviceLocationPermission | undefined> = [
  'granted',
  'prompt',
  'denied',
  'unavailable',
  undefined,
]

describe('the three sources are named, because a rider cannot withdraw what they cannot see', () => {
  it('names the device when the position came from it', () => {
    const result = describeRiderLocation({ position: DEVICE, town: null, permission: 'granted' })
    expect(result.heading).toBe('Using your device location')
  })

  it('names the town when the position came from the profile', () => {
    const result = describeRiderLocation({
      position: PROFILE,
      town: 'Utrecht',
      permission: 'prompt',
    })
    expect(result.heading).toBe('Using the town you told us: Utrecht')
  })

  it('says so plainly when there is no position at all', () => {
    const result = describeRiderLocation({ position: null, town: null, permission: 'prompt' })
    expect(result.heading).toBe('No location set')
  })
})

describe('canRemove tracks the stored TOWN, not the position', () => {
  it('offers removal for a stored town underneath a device fix', () => {
    // **The case that decides the implementation.** The chain prefers the
    // device, so this rider's position says `device` while `profiles.location`
    // still holds a town they typed. Keying `canRemove` off the position would
    // leave them unable to remove it — which is the withdrawal obligation
    // failing in the one state where the rider is least likely to look.
    const result = describeRiderLocation({
      position: DEVICE,
      town: 'Utrecht',
      permission: 'granted',
    })
    expect(result.canRemove).toBe(true)
    expect(result.detail).toContain('Utrecht')
  })

  it('offers no removal for a device fix with no stored town', () => {
    // A device fix is read live and never written down, so a `Remove` beside it
    // would promise the deletion of something that does not exist.
    const result = describeRiderLocation({ position: DEVICE, town: null, permission: 'granted' })
    expect(result.canRemove).toBe(false)
  })

  it('offers removal for a stored town that does not resolve to a position', () => {
    // A town the geocoder cannot place: no position, but something IS stored,
    // and it is the thing the rider has to change to fix the screen.
    const result = describeRiderLocation({
      position: null,
      town: 'Nowhere-on-Sea',
      permission: 'prompt',
    })
    expect(result.canRemove).toBe(true)
  })

  it.each(EVERY_PERMISSION)(
    'offers no removal when nothing is stored, whatever the permission says (%s)',
    (permission) => {
      expect(describeRiderLocation({ position: null, town: null, permission }).canRemove).toBe(
        false
      )
    }
  )
})

describe('the free-text column is reduced before it is shown', () => {
  it.each([
    ['Amsterdam', 'Amsterdam'],
    ['Amsterdam, Netherlands', 'Amsterdam'],
    ['Amsterdam, NL', 'Amsterdam'],
  ])('renders %s as %s', (stored, shown) => {
    // `profiles.location` is free text and riders type all three of these — all
    // three are in the database. Showing the raw column here would put a
    // country name in a sentence about a town.
    const result = describeRiderLocation({
      position: PROFILE,
      town: stored,
      permission: 'prompt',
    })
    expect(result.heading).toBe(`Using the town you told us: ${shown}`)
  })

  it('treats a blank town as nothing stored', () => {
    // `018` permits a string of spaces, and `localityOf` answers null for it —
    // so a rider who submitted whitespace has stored nothing, and must not be
    // shown a `Remove` for it.
    const result = describeRiderLocation({ position: null, town: '   ', permission: 'prompt' })
    expect(result.canRemove).toBe(false)
  })
})

describe('a rider with no position is told which of the three reasons applies', () => {
  it('points a denied rider at their device settings', () => {
    // The one-way state on iOS. Telling them to add a town without mentioning
    // the switch they just flipped leaves them with half the picture.
    const result = describeRiderLocation({ position: null, town: null, permission: 'denied' })
    expect(result.detail).toContain('device settings')
  })

  it('offers both routes to a rider who has simply never been asked', () => {
    const result = describeRiderLocation({ position: null, town: null, permission: 'prompt' })
    expect(result.detail).toContain('town')
    expect(result.detail).toContain('device location')
  })

  it('does not claim a device state before the permission has been read', () => {
    // `undefined` is "the Permissions API has not answered". Copy asserting the
    // device is switched off there would be a guess rendered as a fact.
    const result = describeRiderLocation({ position: null, town: null, permission: undefined })
    expect(result.detail).not.toContain('switched off')
  })
})
