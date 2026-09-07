// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { RideStatusChip } from '@/components/rides/RideStatusChip'

/**
 * The chip catches focus when the RSVP bar collapses out from under the rider
 * — PD-404, and the remedy for the accessibility defect the pre-merge review
 * found in the first cut of this change.
 *
 * ## The defect this pins
 *
 * Answering unmounts `RideAttendanceBar`. That destroys **the focused button
 * and the `role="status"` live region together**, because both are inside it.
 * Focus falls to `document.body`, so a keyboard rider is returned to the top of
 * the document; and nothing announces the change, because the region that would
 * have is part of the subtree being removed. It is the mirror image of the
 * hazard that bar's own comment describes — there, a region created *with* its
 * content announces nothing; here, a region destroyed *at* the moment of change
 * does the same.
 *
 * That lands on the one transition after which this chip is the **only** route
 * back to the answer, so a rider who cannot find it cannot change their mind.
 *
 * **Moving focus here is also the announcement**, which is why no replacement
 * live region exists to test: focusing a control reads its accessible name and
 * state, and this one's name already says what was answered and that tapping
 * changes it.
 *
 * ## Why jsdom, and why a token rather than a boolean
 *
 * Focus is not in markup, so `renderToStaticMarkup` cannot see any of this —
 * the *mounted effect* case in the repo's list of four reasons to reach for
 * jsdom.
 *
 * The second case below is why the prop is a counter. Answering for the first
 * time **mounts** this chip, which a mount-keyed flag would catch. Answering
 * *again* from a bar the chip itself reopened does not: the chip is already
 * drawn and stays drawn, and only the bar unmounts — so a boolean would miss
 * exactly the rider who has been through the cycle once already.
 *
 * **Verified both ways.** Making the effect fire on mount only — `[]` deps
 * instead of `[focusToken]`, the shape a "the token never changes identity"
 * simplification produces — gives **1 failed, 2 passed**: the re-answer case
 * alone, which is the one that distinguishes the two implementations.
 */
describe('RideStatusChip — catching focus from the collapsing bar', () => {
  function mount() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    return { container, root: createRoot(container) }
  }

  it('does not steal focus on an ordinary page load', () => {
    // The default. A rider arriving at an already-answered ride is reading the
    // header; yanking focus down to a chip would be the fix causing a worse
    // defect than the one it repairs.
    const { container, root } = mount()
    act(() => {
      root.render(<RideStatusChip attendance="going" open={false} onToggle={() => {}} />)
    })

    expect(document.activeElement).not.toBe(container.querySelector('button'))
  })

  it('takes focus when the rider answers for the first time and the chip appears', () => {
    // The chip mounts in the same commit that unmounts the bar, so the effect
    // runs with a non-zero token already set.
    const { container, root } = mount()
    act(() => {
      root.render(
        <RideStatusChip attendance="going" open={false} onToggle={() => {}} focusToken={1} />
      )
    })

    expect(document.activeElement).toBe(container.querySelector('button'))
  })

  it('takes focus again when an already-drawn chip sees a second answer', () => {
    // The case a mount-keyed flag misses: the rider reopened the bar with this
    // chip, so the chip never unmounted. Only the bar goes.
    const { container, root } = mount()
    act(() => {
      root.render(
        <RideStatusChip attendance="going" open onToggle={() => {}} focusToken={1} />
      )
    })
    act(() => {
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    expect(document.activeElement).not.toBe(container.querySelector('button'))

    act(() => {
      root.render(
        <RideStatusChip attendance="maybe" open={false} onToggle={() => {}} focusToken={2} />
      )
    })

    expect(document.activeElement).toBe(container.querySelector('button'))
  })
})
