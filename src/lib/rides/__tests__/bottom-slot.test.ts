import { describe, expect, it } from 'vitest'
import { resolveRideDetailActions } from '@/lib/rides/bottom-slot'
import { isRideCrew } from '@/lib/data/rides'
import { routes } from '@/lib/routes'
import type { RideAttendance } from '@/types'

/**
 * `resolveRideDetailActions` — PD-401's collision as PD-404 reshaped it.
 *
 * **The invariants are three, and none of them is any individual row:**
 *
 * 1. the RSVP bar and the create action are never both drawn — answering
 *    replaces the bar rather than stacking anything on it;
 * 2. `createOptions` is non-empty **if and only if** the create action is
 *    drawn. An empty sheet behind a live control is invisible to `tsc`, to
 *    ESLint and to every render test — the only thing that sees it is a rider
 *    tapping and getting a blank panel;
 * 3. **a rider with a stored answer always has the chip**, including while they
 *    have reopened the bar with it. That is the one that looks like a detail
 *    and is not: the chip is the only route back once the bar has collapsed, so
 *    hiding it while the bar is open leaves a rider who changes their mind with
 *    no way to close it and no create affordance either.
 *
 * Verified both ways per CLAUDE.md §Working Principles. Three mutations were
 * run against `bottom-slot.ts` and each fails a different pair:
 *
 * - hiding the chip while `reopened` (`&& !reopened` on `statusChip`) →
 *   **2 failed, 7 passed**;
 * - `barDrawn` ignoring `reopened` (the "the chip is just a badge"
 *   simplification) → **1 failed, 8 passed**;
 * - returning the options unconditionally rather than only on the `create`
 *   arm → **3 failed, 6 passed**.
 *
 * **The second is caught by a named row alone and that is not a gap to close
 * with another property.** *Reopening brings the bar back* is a behaviour, not
 * an invariant over the input space: every property here still holds when the
 * chip is inert, because an inert chip is a coherent design — just not the one
 * the owner decided. A property restating the row would only assert the
 * implementation against itself.
 *
 * ## Why there is no `timelineAdd` any more
 *
 * PD-401 kept a `(+)` on the timeline heading for *upcoming + crew + the RSVP
 * bar owns the slot*. That state is unreachable under this design, and the
 * proof is a read rather than a composition: `is_crew` is
 * `isRideCrew(isOrganizer, ownRow?.status ?? null)`
 * (`src/lib/data/rides.ts:618`), which is `isOrganizer || attendance !== null`
 * (`:692`) — so for a non-organizer, crew ⟺ answered. The bar is owed only
 * while the answer is `null`, which is exactly when that rider is not crew.
 * `unreachable states` below asserts that identity **against the imported
 * `isRideCrew`**, because it is the whole reason the fallback was deleted and
 * nothing else in the repo would notice it coming back.
 *
 * **That assertion was a tautology when it was first written, and the fourth
 * mutation is what proves it is not one now.** It declared a local copy of the
 * rule and asserted the copy against itself; narrowing the real helper to
 * `isOrganizer || attendance === 'going'` — the narrowing that function's own
 * docstring anticipates — left **all 9 green**. Against the imported helper the
 * same mutation gives **1 failed, 8 passed**. A grep for `isRideCrew` looked
 * reassuring throughout, because the word was in the comment claiming the
 * assertion existed: §the comment trap, applied to an assertion rather than to
 * a retired pattern.
 */
const RIDE = '11111111-1111-4111-8111-111111111111'

const OPTIONS = [
  { kind: 'postcard', label: 'Postcard', href: routes.newPostcardInRide(RIDE) },
  { kind: 'thread', label: 'Thread', href: routes.newRideThread(RIDE) },
]

const ATTENDANCES: RideAttendance[] = ['going', 'maybe', null]

/** Every combination of the four inputs — 2 × 3 × 2 × 2 = 24, so exhaustive. */
function everyCase() {
  const cases = []
  for (const rsvpApplies of [true, false]) {
    for (const attendance of ATTENDANCES) {
      for (const canCreate of [true, false]) {
        for (const reopened of [true, false]) {
          cases.push({ rsvpApplies, attendance, canCreate, reopened })
        }
      }
    }
  }
  return cases
}

describe('resolveRideDetailActions', () => {
  it('gives the slot to the RSVP bar and draws no chip before the rider has answered', () => {
    // Today's behaviour, unchanged by PD-404 and the state most riders open an
    // upcoming ride in. `canCreate` is false because an unanswered non-organizer
    // is not crew — see `unreachable states` below.
    expect(
      resolveRideDetailActions({
        rideId: RIDE,
        rsvpApplies: true,
        attendance: null,
        canCreate: false,
        reopened: false,
      })
    ).toEqual({ bottomSlot: 'rsvp', statusChip: null, createOptions: [] })
  })

  it('collapses the bar into a chip and hands the slot to the create action once the rider has answered', () => {
    // The decision itself. Both stored answers, because `maybe` is crew exactly
    // as `going` is — `private.is_ride_crew` takes a row of either status.
    for (const attendance of ['going', 'maybe'] as const) {
      expect(
        resolveRideDetailActions({
          rideId: RIDE,
          rsvpApplies: true,
          attendance,
          canCreate: true,
          reopened: false,
        })
      ).toEqual({ bottomSlot: 'create', statusChip: attendance, createOptions: OPTIONS })
    }
  })

  it('brings the bar back when the rider taps the chip, and keeps the chip so they can close it again', () => {
    // Invariant 3. Dropping the chip here is the tidy-up that looks correct —
    // "the bar is showing, the chip is redundant" — and strands a rider who
    // reopened it with nothing to tap and no create affordance.
    expect(
      resolveRideDetailActions({
        rideId: RIDE,
        rsvpApplies: true,
        attendance: 'going',
        canCreate: true,
        reopened: true,
      })
    ).toEqual({ bottomSlot: 'rsvp', statusChip: 'going', createOptions: [] })
  })

  it('gives the organizer and the past ride the create action and no chip', () => {
    // `rsvpApplies` false covers both: the organizer cannot decline their own
    // ride coherently, and answering "are you going" about a ride that has
    // already left would silently edit history. Neither gets a chip, because a
    // chip whose tap does nothing is worse than no chip.
    for (const attendance of ATTENDANCES) {
      expect(
        resolveRideDetailActions({
          rideId: RIDE,
          rsvpApplies: false,
          attendance,
          canCreate: true,
          reopened: false,
        })
      ).toEqual({ bottomSlot: 'create', statusChip: null, createOptions: OPTIONS })
    }
  })

  it('offers a non-crew viewer no create entrance, whatever the slot is doing', () => {
    // `041` refuses the insert and `108` refuses the thread, and a control the
    // database always refuses is worse than no control.
    expect(
      resolveRideDetailActions({
        rideId: RIDE,
        rsvpApplies: false,
        attendance: null,
        canCreate: false,
        reopened: false,
      })
    ).toEqual({ bottomSlot: null, statusChip: null, createOptions: [] })
  })

  it('never draws the RSVP bar and the create action together', () => {
    // Invariant 1, over the whole input space. `bottomSlot` being a single
    // value makes this true by construction TODAY; it is asserted anyway
    // because the shape that broke it — option A, two stacked bars — is the one
    // PD-401 says must never ship silently, and it would arrive as a second
    // field rather than as a third value here.
    for (const input of everyCase()) {
      const { bottomSlot } = resolveRideDetailActions({ rideId: RIDE, ...input })
      expect({ ...input, drawn: [bottomSlot].filter(Boolean).length }).toEqual({
        ...input,
        drawn: bottomSlot === null ? 0 : 1,
      })
    }
  })

  it('never opens a sheet with nothing in it, and never withholds one that is needed', () => {
    // Invariant 2, over the whole input space, in both directions. Only one of
    // them is obvious: rows computed for a rider offered no entrance are
    // harmless, but they mean the two halves have drifted apart, which is what
    // makes the converse worth asserting too.
    for (const input of everyCase()) {
      const { bottomSlot, createOptions } = resolveRideDetailActions({ rideId: RIDE, ...input })
      expect({ ...input, agree: (bottomSlot === 'create') === (createOptions.length > 0) }).toEqual({
        ...input,
        agree: true,
      })
    }
  })

  it('draws the chip exactly when the rider has an answer the bar could change', () => {
    // Invariant 3 as a property: the chip follows `rsvpApplies && answered` and
    // nothing else — not `reopened`, and not `canCreate`. Tying it to
    // `canCreate` would be the plausible-looking mistake, since the two agree on
    // every reachable input; `unreachable states` below is what keeps that
    // agreement from being load-bearing.
    for (const input of everyCase()) {
      const { statusChip } = resolveRideDetailActions({ rideId: RIDE, ...input })
      expect({ ...input, statusChip }).toEqual({
        ...input,
        statusChip: input.rsvpApplies && input.attendance !== null ? input.attendance : null,
      })
    }
  })

  it('unreachable states — an unanswered non-organizer is never crew, which is why the timeline (+) is gone', () => {
    // Not a test of this function: a test of the identity this function's shape
    // RESTS on, pinned here because `bottom-slot.ts` is where a later session
    // would reintroduce the fallback. `getRide` derives `is_crew` as
    // `isRideCrew(isOrganizer, ownRow?.status ?? null)`, so for a viewer who is
    // not the organizer the two are the same fact. If that ever stops being
    // true, the state PD-401's `(+)` covered becomes reachable again and this
    // row is the thing that says so.
    //
    // **Against the imported `isRideCrew`, never a local copy of it** — see the
    // module docstring for what a local copy cost here.
    for (const attendance of ATTENDANCES) {
      expect({ attendance, crew: isRideCrew(false, attendance) }).toEqual({
        attendance,
        crew: attendance !== null,
      })
    }

    // The organizer arm, for completeness: they are crew with no row at all,
    // which is why `rsvpApplies` rather than this identity is what excludes
    // them from the chip.
    expect(isRideCrew(true, null)).toBe(true)

    // The consequence: with `rsvpApplies` true (so not the organizer), the bar
    // and a create entrance are never simultaneously owed by the DATABASE's
    // rule, whatever this function does with them.
    for (const attendance of ATTENDANCES) {
      const canCreate = isRideCrew(false, attendance)
      const { bottomSlot } = resolveRideDetailActions({
        rideId: RIDE,
        rsvpApplies: true,
        attendance,
        canCreate,
        reopened: false,
      })
      expect({ attendance, bottomSlot }).toEqual({
        attendance,
        bottomSlot: attendance === null ? 'rsvp' : 'create',
      })
    }
  })
})
