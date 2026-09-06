import { describe, expect, it } from 'vitest'
import { resolveRideDetailActions } from '@/lib/rides/bottom-slot'
import { routes } from '@/lib/routes'

/**
 * `resolveRideDetailActions` — PD-401's collision, and the one property the
 * composition rests on.
 *
 * **The invariant is complementarity**, not any individual row: a rider who may
 * create is offered exactly ONE entrance to the create sheet. Two would
 * put a bar and a `(+)` on the same screen for the same destination; none would
 * silently delete the entrance PD-125 exists to protect, and nothing else in
 * the repo would go red — the screen still renders, `tsc` sees a boolean, and
 * the walk asks only whether the route loaded.
 *
 * Verified both ways per CLAUDE.md §Working Principles. Two mutations were run
 * against this file and each fails the same pair — *gives the slot to the create
 * bar and drops the plus…* and the exhaustive property below:
 *
 * - `timelineAdd: true` on the create-bar arm (the "just use `canCreate`"
 *   simplification) → 2 failed, 3 passed;
 * - `bottomSlot: 'rsvp'` unconditionally (the RSVP bar never yielding the slot)
 *   → 2 failed, 3 passed.
 *
 * That the property test catches both is the point of it: the named rows say
 * what each answer is, and it says what no future answer may be.
 */
const RIDE = '11111111-1111-4111-8111-111111111111'

/**
 * `108` (PD-402) gave a ride a second thing to create, so every call now takes
 * a ride id and every answer carries the sheet's rows. The two options are
 * asserted by `kind` rather than by href, so a route rename is caught by
 * `routes.ts`'s own types instead of failing here for the wrong reason.
 */
const OPTIONS = [
  { kind: 'postcard', label: 'Postcard', href: routes.newPostcardInRide(RIDE) },
  { kind: 'thread', label: 'Thread', href: routes.newRideThread(RIDE) },
]

describe('resolveRideDetailActions', () => {
  it('gives the slot to the RSVP bar and the plus to the heading on an upcoming ride the crew member does not organize', () => {
    // The case the create bar cannot have, and the reason the `(+)` survives at
    // all. PD-401 priced plain option B as "an upcoming ride's crew loses it";
    // this row is that cost being refused.
    expect(resolveRideDetailActions({ rideId: RIDE, canRsvp: true, canCreate: true })).toEqual({
      bottomSlot: 'rsvp',
      timelineAdd: true,
      createOptions: OPTIONS,
    })
  })

  it('gives the slot to the create bar and drops the plus on a past ride the rider is crew on', () => {
    // The case the story is FOR: a rider photographs a ride that has happened,
    // and a past ride has no RSVP bar to compete for the slot.
    expect(resolveRideDetailActions({ rideId: RIDE, canRsvp: false, canCreate: true })).toEqual({
      bottomSlot: 'create',
      timelineAdd: false,
      createOptions: OPTIONS,
    })
  })

  it('offers a non-crew viewer neither entrance, whatever the slot is doing', () => {
    // `041` refuses the insert, and a control the database always refuses is
    // worse than no control. Both rows, because `canRsvp` must not be able to
    // buy a create affordance.
    expect(resolveRideDetailActions({ rideId: RIDE, canRsvp: true, canCreate: false })).toEqual({
      bottomSlot: 'rsvp',
      timelineAdd: false,
      createOptions: [],
    })
    expect(resolveRideDetailActions({ rideId: RIDE, canRsvp: false, canCreate: false })).toEqual({
      bottomSlot: null,
      timelineAdd: false,
      createOptions: [],
    })
  })

  it('never offers two entrances to one composer, and never zero to a rider who may create', () => {
    // The property itself, over the whole input space — four combinations, so
    // this is exhaustive rather than a sample. The rows above say what each
    // answer IS; this says what no future answer may be.
    for (const canRsvp of [true, false]) {
      for (const canCreate of [true, false]) {
        const { bottomSlot, timelineAdd } = resolveRideDetailActions({
          rideId: RIDE,
          canRsvp,
          canCreate,
        })
        const entrances = Number(bottomSlot === 'create') + Number(timelineAdd)
        expect({ canRsvp, canCreate, entrances }).toEqual({
          canRsvp,
          canCreate,
          entrances: canCreate ? 1 : 0,
        })
      }
    }
  })

  it('never opens a sheet with nothing in it, and never withholds one that is needed', () => {
    // `108`'s added invariant, over the whole input space: `createOptions` is
    // non-empty **if and only if** an entrance is drawn. Both directions matter
    // and only one of them is obvious. An empty sheet behind a live `Create`
    // button is invisible to `tsc`, to ESLint and to every render test — the
    // only thing that sees it is a rider tapping and getting a blank panel. The
    // converse — rows computed for a rider who is offered no entrance — is
    // harmless but means the two halves have drifted apart, which is what makes
    // it worth asserting rather than only the first.
    for (const canRsvp of [true, false]) {
      for (const canCreate of [true, false]) {
        const { bottomSlot, timelineAdd, createOptions } = resolveRideDetailActions({
          rideId: RIDE,
          canRsvp,
          canCreate,
        })
        const hasEntrance = bottomSlot === 'create' || timelineAdd
        expect({ canRsvp, canCreate, agree: hasEntrance === createOptions.length > 0 }).toEqual({
          canRsvp,
          canCreate,
          agree: true,
        })
      }
    }
  })

  it('offers the same rows from both entrances', () => {
    // The bar and the `(+)` are never drawn together, so no screen can show the
    // divergence — the guarantee is that they read ONE list. Asserted as the
    // two reachable answers being identical rather than by inspecting a
    // component, because the sharing is what `bottom-slot.ts` is for.
    const barCase = resolveRideDetailActions({ rideId: RIDE, canRsvp: false, canCreate: true })
    const plusCase = resolveRideDetailActions({ rideId: RIDE, canRsvp: true, canCreate: true })
    expect(barCase.createOptions).toEqual(plusCase.createOptions)
  })

  it('never lets the create bar take a slot the RSVP bar needs', () => {
    // The RSVP bar wins outright: answering "are you going" is what stops being
    // possible once the ride has left, and stacking the two is option A, which
    // PD-401 says not to ship silently.
    for (const canCreate of [true, false]) {
      expect(
        resolveRideDetailActions({ rideId: RIDE, canRsvp: true, canCreate }).bottomSlot
      ).toBe('rsvp')
    }
  })
})
