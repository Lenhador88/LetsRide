import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/actions/rides', () => ({ setRideAttendance: vi.fn() }))

const { RideAttendanceBar } = await import('@/components/rides/RideAttendanceBar')

/**
 * **Which options the bar offers, which is a different question from what it
 * does when one is tapped** — that is `RideAttendanceBar.dom.test.tsx`, and it
 * is jsdom because it asserts a sequence across an async transition. This one is
 * a property of the rendered markup with no event in it, so it runs under
 * `environment: 'node'` like most of this repo's component tests.
 *
 * ## The rule, and why it is one option rather than the whole control
 *
 * PD-429 gave the organizer an RSVP bar for the first time. `103`'s
 * `protect_ride_organizer_membership` is a `BEFORE DELETE` guard: it protects
 * their *presence* on their own ride and says nothing about their *status*, so
 * `going → maybe` is an UPDATE the database permits. `No` is the one answer that
 * would `delete` the row, and it is the only one withheld.
 *
 * **What this catches is the two ways it reverts silently.** Widening
 * `ORGANIZER_OPTIONS` back to `OPTIONS` gives the organizer a button
 * `setRideAttendance` reports a refusal for — a control the database refuses,
 * which is the property PD-401 pinned for the create action and the same one
 * here. Narrowing the *other* direction — dropping `canDecline`'s `= true`
 * default, or wiring it to `is_organizer` with the sense inverted — takes `No`
 * away from every ordinary rider, and `tsc` sees a boolean either way.
 */

const bar = (props: { canDecline?: boolean }) =>
  renderToStaticMarkup(<RideAttendanceBar rideId="ride-1" attendance={null} {...props} />)

describe('RideAttendanceBar options', () => {
  it('offers a rider all three answers', () => {
    const html = bar({})

    expect(html).toContain('Yes!')
    expect(html).toContain('Maybe...')
    expect(html).toContain('>No<')
  })

  it('withholds No from the organizer, and nothing else', () => {
    const html = bar({ canDecline: false })

    expect(html).not.toContain('>No<')
    // The other two survive: withholding the whole control is what this replaced.
    expect(html).toContain('Yes!')
    expect(html).toContain('Maybe...')
  })

  it('defaults to offering No, so a caller opts out rather than in', () => {
    // Every caller that is not the ride detail keeps the three-option bar it had
    // before this prop existed. A default of `false` would silently strip `No`
    // from any future caller that forgot to pass it.
    expect(bar({})).toBe(bar({ canDecline: true }))
  })

  it('still asks the organizer the same question', () => {
    // The prompt is the live region a failed write writes into, so it must exist
    // on both variants — see the `role="status"` note in the component.
    expect(bar({ canDecline: false })).toContain('Are you going?')
    expect(bar({ canDecline: false })).toContain('role="status"')
  })
})
