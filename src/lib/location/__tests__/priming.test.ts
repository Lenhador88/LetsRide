import { describe, expect, it } from 'vitest'
import { locationPrimingState, locationQuestionLabel } from '@/lib/location/priming'
import type { DeviceLocationPermission, RiderLocation } from '@/lib/location/rider-location'

/**
 * `locationPrimingState` and the line it produces — which of six things, if
 * anything, an Explore screen draws to ask a rider where they ride from
 * (PD-170, PD-419, PD-447).
 *
 * The whole reason this decision is a pure function rather than a branch inside
 * `LocationQuestionRow` is that it now has four inputs and only two of its
 * states are things a rendering test could reach. Each case below names the
 * defect it exists to stop, per this repo's convention.
 *
 * **Three cases here are deliberate REVERSALS of an earlier state, kept as
 * inverted assertions so a revert cannot pass silently**: PD-419 turned two
 * `hidden` answers into `town` and `refine`, and PD-447 turned the
 * profile-position + `denied`/`unavailable` `hidden` into `confirm`.
 * `priming.ts`'s header carries each argument.
 *
 * **Verified both ways** (mutate, watch it go red, revert): returning `refine`
 * instead of `confirm` for `denied` fails *goes straight to the town*; dropping
 * the `town === undefined` guard fails *hides while the town read is in
 * flight*; dropping the `quiet` gate fails every case in *a recent dismissal
 * silences every visible state*; and passing `nearLabel`'s output through
 * instead of the raw column fails *never renders `Still in you?`*.
 */

const DEVICE: RiderLocation = { lat: 52.09, lon: 5.12, source: 'device' }
const PROFILE: RiderLocation = { lat: 52.09, lon: 5.12, source: 'profile' }

const EVERY_PERMISSION: DeviceLocationPermission[] = ['granted', 'prompt', 'denied', 'unavailable']

/** The three inputs that are not the one under test, in their settled,
 *  nothing-to-hide-behind values. */
const SETTLED = { town: null, quiet: false } as const

describe('nothing is drawn against an undecided input', () => {
  it.each(EVERY_PERMISSION)(
    'hides while the position is still resolving, whatever the permission says (%s)',
    (permission) => {
      // The defect: the row flashes onto every load and vanishes when the
      // position lands a beat later.
      expect(locationPrimingState({ ...SETTLED, permission, position: undefined })).toBe('hidden')
    }
  )

  it.each([[null], [DEVICE], [PROFILE]])(
    'hides while the permission is still unread, whatever the position says (%o)',
    (position) => {
      // The defect: a rider who granted location months ago watches a question
      // about a town appear and disappear on every screen.
      expect(locationPrimingState({ ...SETTLED, permission: undefined, position })).toBe('hidden')
    }
  )

  it('hides while the town read is in flight, even with everything else settled', () => {
    // The defect PD-447 adds: the question names the town, so drawing it before
    // the column has landed renders `Where do you ride from?` at a rider who
    // told us months ago — and then swaps to `Still in Hoorn?` a beat later.
    expect(
      locationPrimingState({ permission: 'prompt', position: PROFILE, town: undefined, quiet: false })
    ).toBe('hidden')
  })

  it('hides while the dismissal record has not been read yet', () => {
    // `localStorage` is read in an effect, like the other three. Drawing
    // against an unread store shows the question to a rider who dismissed it
    // yesterday, for one frame, every load.
    expect(
      locationPrimingState({ permission: 'prompt', position: null, town: null, quiet: undefined })
    ).toBe('hidden')
  })
})

describe('a recent dismissal silences every visible state', () => {
  const VISIBLE: { name: string; permission: DeviceLocationPermission; position: RiderLocation | null; town: string | null }[] =
    [
      { name: 'ask', permission: 'prompt', position: null, town: null },
      { name: 'blocked', permission: 'denied', position: null, town: null },
      { name: 'town', permission: 'unavailable', position: null, town: null },
      { name: 'refine', permission: 'prompt', position: PROFILE, town: 'Hoorn' },
      { name: 'confirm', permission: 'denied', position: PROFILE, town: 'Hoorn' },
    ]

  it.each(VISIBLE)(
    'hides $name while the quiet interval is still running',
    ({ permission, position, town }) => {
      // The defect: the gate is applied in the component for one state and the
      // rider who dismissed on `/rides/explore` is asked again on
      // `/clubs/explore` two taps later. One gate, ahead of every branch.
      expect(locationPrimingState({ permission, position, town, quiet: true })).toBe('hidden')
    }
  )
})

describe('states with nothing left to ask for', () => {
  it.each([[DEVICE], [PROFILE], [null]])(
    'hides once the permission is granted, whatever the position turned out to be (%o)',
    (position) => {
      // A granted permission with a null position is a GPS acquisition that
      // failed or timed out; a question about a town is the wrong answer to it,
      // and the device is already the source the distances use.
      expect(locationPrimingState({ ...SETTLED, permission: 'granted', position })).toBe('hidden')
    }
  )

  it.each<DeviceLocationPermission>(['prompt', 'denied', 'unavailable'])(
    'hides beside a DEVICE position whose permission has since changed (%s)',
    (permission) => {
      // Reachable through the resolver's five-minute memo outliving a
      // revocation. The position on screen is real and measured from the
      // device, so asking about a town would be asking about somewhere the
      // distances are not measured from.
      expect(locationPrimingState({ ...SETTLED, permission, position: DEVICE })).toBe('hidden')
    }
  )
})

describe('the rider has a town-sourced position — refine, or confirm', () => {
  it('offers the device upgrade while the device can still be asked', () => {
    // **Reversed by PD-419.** This read `hidden`, on the grounds that a rider
    // with a working position must not be nagged. The rider it exists for has
    // `Utrecht` on their profile and is in Maastricht: every distance is wrong
    // and nothing on the screen said so.
    expect(
      locationPrimingState({ permission: 'prompt', position: PROFILE, town: 'Utrecht', quiet: false })
    ).toBe('refine')
  })

  it.each<DeviceLocationPermission>(['denied', 'unavailable'])(
    'goes straight to the town when there is no device left to offer (%s)',
    (permission) => {
      // **Reversed by PD-447, and this is the rider the reversal is for.** The
      // old `hidden` was correct while the row said *Use my location*: iOS will
      // not re-raise the dialog for the life of the install, so the row would
      // have been a dead end. Once it asks about the TOWN there is a route that
      // works — and it must not be the device one.
      expect(
        locationPrimingState({ permission, position: PROFILE, town: 'Hoorn', quiet: false })
      ).toBe('confirm')
    }
  )

  it('still answers confirm when the stored town has gone but the position has not', () => {
    // Two independently cached reads: the position memo outlives an
    // invalidation of `queryKeys.profile.location()`, and the town can be
    // cleared on another device. The state must not depend on the town being
    // present — only the LABEL does, and it falls back rather than rendering a
    // gap.
    expect(
      locationPrimingState({ permission: 'denied', position: PROFILE, town: null, quiet: false })
    ).toBe('confirm')
  })
})

describe('the rider has no position at all', () => {
  it('asks when the device will prompt', () => {
    expect(locationPrimingState({ ...SETTLED, permission: 'prompt', position: null })).toBe('ask')
  })

  it('reports blocked when the device has already refused', () => {
    // The one-way state on iOS. The row still draws — it is the only place that
    // can explain what was lost and where to switch it back on, and it carries
    // the town question underneath.
    expect(locationPrimingState({ ...SETTLED, permission: 'denied', position: null })).toBe(
      'blocked'
    )
  })

  it('asks for a town on a platform with no geolocation', () => {
    // **Reversed by PD-419**, and it was the state with the worst outcome: a
    // rider on a WebView with no geolocation, or behind an MDM that strips it,
    // had no position, no device to ask, and no affordance anywhere saying so.
    expect(locationPrimingState({ ...SETTLED, permission: 'unavailable', position: null })).toBe(
      'town'
    )
  })
})

describe('the line the row draws', () => {
  it('draws nothing at all in hidden', () => {
    expect(locationQuestionLabel('hidden', 'Hoorn')).toBeNull()
  })

  it.each(['refine', 'confirm'] as const)('names the town in %s', (state) => {
    expect(locationQuestionLabel(state, 'Hoorn')).toBe('Still in Hoorn?')
  })

  it.each(['refine', 'confirm'] as const)('reduces the raw column in %s', (state) => {
    // `profiles.location` is free text and riders type all four of these. The
    // reduction happens HERE rather than at the call site, which is what keeps
    // every screen naming the town the same way.
    expect(locationQuestionLabel(state, 'Amsterdam, Netherlands')).toBe('Still in Amsterdam?')
    expect(locationQuestionLabel(state, 'Hoorn Netherlands')).toBe('Still in Hoorn?')
  })

  it.each(['ask', 'blocked', 'town'] as const)('asks the open question in %s', (state) => {
    // These three have no town to name — and must not invent one from a stale
    // column, which is why the state decides and not the presence of a string.
    expect(locationQuestionLabel(state, 'Hoorn')).toBe('Where do you ride from?')
  })

  it('never renders `Still in you?`', () => {
    // **The trap PD-447's design found.** Every call site used to pass
    // `nearLabel(position, city)?.name`, and `nearLabel` answers the literal
    // `you` for a device fix AND for a city `localityOf` will not shorten.
    // `Near you · Use my location` absorbed that; a question does not. The row
    // takes the raw column and this function reduces it, so `you` can only
    // appear if a rider literally lives somewhere called that.
    for (const state of ['refine', 'confirm'] as const) {
      expect(locationQuestionLabel(state, null)).not.toContain('you?')
      expect(locationQuestionLabel(state, '   ')).not.toContain('you?')
    }
  })

  it.each(['refine', 'confirm'] as const)(
    'falls back to the open question when the town will not reduce (%s)',
    (state) => {
      // `018` permits a town of spaces, and `localityOf` answers null for
      // anything with nothing before its first comma. The alternative is
      // `Still in ?`, which is the one output worse than asking again.
      expect(locationQuestionLabel(state, '   ')).toBe('Where do you ride from?')
      expect(locationQuestionLabel(state, null)).toBe('Where do you ride from?')
      expect(locationQuestionLabel(state, ', Netherlands')).toBe('Where do you ride from?')
    }
  )
})
