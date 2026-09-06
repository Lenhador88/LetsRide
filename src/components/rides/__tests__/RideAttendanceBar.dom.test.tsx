// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const setRideAttendance = vi.fn()

vi.mock('@/lib/actions/rides', () => ({
  setRideAttendance: (...args: unknown[]) => setRideAttendance(...args),
}))

const { RideAttendanceBar } = await import('@/components/rides/RideAttendanceBar')

/**
 * `onAnswered` fires on a write the server **accepted**, and on nothing else —
 * PD-404's collapse, and the one row of its state machine that no other gate
 * can see.
 *
 * ## Why this file is jsdom when 28 of the repo's 33 component tests are not
 *
 * The property is a **sequence across an async transition**: tap → await the
 * action → branch on the result. `renderToStaticMarkup` runs no events and no
 * effects, so a static render cannot distinguish "fires on success only" from
 * "fires always" — both produce byte-identical markup. This is the *event* case
 * in the repo's own list of the four reasons to reach for jsdom, and it is the
 * same reason `PostcardMenu.test.tsx` gives.
 *
 * ## What breaks if it fires on failure
 *
 * The page drops `rsvpReopened` on this callback, which collapses the RSVP bar
 * back into the status chip. On a failed write the bar has already rolled the
 * pill back to the previous answer and is showing the rider why — so collapsing
 * it there hides the error message **and** leaves the chip displaying the old
 * value, with nothing anywhere saying the change did not land. The rider's next
 * signal would be a headcount that never moved.
 *
 * That is a one-line mistake — dropping the `return` in the error branch, or
 * moving the call above it — and every other gate stays green through it: the
 * markup is the same, `tsc` sees a `void` callback, and the walk does not fail
 * a write.
 *
 * **Verified both ways.** Moving `onAnswered?.()` above the error branch, so it
 * fires unconditionally, gives **1 failed, 2 passed** — the failure case alone,
 * which is exactly the row that distinguishes the two implementations.
 */
describe('RideAttendanceBar — the collapse contract', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    setRideAttendance.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  /** The `Maybe...` control, found by its visible label rather than by index so
   *  a reordering of `OPTIONS` fails loudly here instead of silently changing
   *  which answer these cases send. */
  function tapMaybe() {
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Maybe')
    )
    expect(button, 'the Maybe control must be rendered').toBeTruthy()
    return button!
  }

  it('reports the answer once the server has accepted it', async () => {
    setRideAttendance.mockResolvedValue({})
    const onAnswered = vi.fn()

    await act(async () => {
      root.render(
        <RideAttendanceBar rideId="r1" attendance={null} onAnswered={onAnswered} />
      )
    })
    await act(async () => {
      tapMaybe().click()
    })

    expect(setRideAttendance).toHaveBeenCalledWith('r1', 'maybe')
    expect(onAnswered).toHaveBeenCalledTimes(1)
  })

  it('stays open and says why when the write is refused, and does NOT report an answer', async () => {
    // The load-bearing row. `setRideAttendance` resolves with an `error` field
    // rather than throwing — that is the shape every action in `lib/actions/`
    // returns, so a test that made it reject would pass against an
    // implementation that is broken for the real failure.
    setRideAttendance.mockResolvedValue({ error: 'You are offline.' })
    const onAnswered = vi.fn()

    await act(async () => {
      root.render(
        <RideAttendanceBar rideId="r1" attendance="going" onAnswered={onAnswered} />
      )
    })
    await act(async () => {
      tapMaybe().click()
    })

    expect(onAnswered).not.toHaveBeenCalled()
    // The message reaches the live region the bar keeps mounted for exactly
    // this — see the `role="status"` note in the component.
    expect(container.textContent).toContain('You are offline.')
  })

  it('works with no callback at all, which is the first-answer path', async () => {
    // A rider answering for the first time has no reopened flag to clear, so
    // the page passes nothing. The optional call must not throw — that would
    // take down the ordinary RSVP on every ride.
    setRideAttendance.mockResolvedValue({})

    await act(async () => {
      root.render(<RideAttendanceBar rideId="r1" attendance={null} />)
    })
    await act(async () => {
      tapMaybe().click()
    })

    expect(setRideAttendance).toHaveBeenCalledWith('r1', 'maybe')
  })
})
