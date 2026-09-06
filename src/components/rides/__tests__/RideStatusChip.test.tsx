import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RideStatusChip } from '@/components/rides/RideStatusChip'

/**
 * The three things that make this a **control** rather than a badge (PD-404),
 * each of which a plausible tidy-up removes without anything else going red.
 *
 * Once answering collapses the RSVP bar, this chip is the **only** route back
 * to it. So a refactor that reuses `RideCard`'s `AttendancePill` here — the
 * obvious de-duplication, since the two render the same fact with the same
 * fills — silently produces a control a gloved rider cannot hit and a screen
 * reader announces as plain text. Nothing in `tsc`, ESLint or the walk sees
 * that: the chip still renders, still says `Going`, and still sits in the right
 * place.
 *
 * `environment: 'node'` with `renderToStaticMarkup`, which is this repo's
 * default for a component test — 28 of the 33 are written this way, and jsdom is
 * the answer only for a mounted effect, a layout, an event or a portal. **None
 * of the three properties below is one of those**: the toggle itself is the
 * page's state, not this component's, so there is no event here worth a jsdom
 * environment to dispatch. What this file pins is the markup a tap will land on.
 *
 * **Verified both ways.** Reverting the control to `AttendancePill`'s span —
 * dropping the `<button>`, the `min-h-11` target, the `aria-expanded` and the
 * chevron, which is exactly the de-duplication described above — gives
 * **3 failed, 2 passed**. The two survivors are the fills and the `No` row, and
 * that they survive is the point: a badge and a control render the same colours
 * and the same nothing-for-`No`, so those two rows cannot be what defends this
 * component. The three that fail are the ones that carry the property.
 */
describe('RideStatusChip', () => {
  it('is a button that announces what the tap does, not a label that reads as text', () => {
    const html = renderToStaticMarkup(
      <RideStatusChip attendance="going" open={false} onToggle={() => {}} />
    )
    expect(html).toContain('<button')
    // The state, not just the value: "Going" alone tells a screen-reader user
    // what they answered and nothing about the control being a way to change it.
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Change your answer')
  })

  it('reports the bar as expanded once the chip has opened it', () => {
    // The chip stays drawn while the bar is open — it is the toggle shut as
    // well as the toggle open — so this state is reachable and must announce
    // itself. `resolveRideDetailActions` is what keeps the chip drawn there;
    // its own test pins that half.
    const html = renderToStaticMarkup(
      <RideStatusChip attendance="going" open onToggle={() => {}} />
    )
    expect(html).toContain('aria-expanded="true"')
  })

  it('carries a hit target at the glove floor, larger than the pill it paints', () => {
    // 44×44 is the floor for a control used with gloves on. The painted pill is
    // ~20px tall by design — it has to match `AttendancePill` visually — so the
    // target is grown around it and pulled back out of the row. A refactor that
    // "removes the odd negative margin" takes the target with it.
    const html = renderToStaticMarkup(
      <RideStatusChip attendance="maybe" open={false} onToggle={() => {}} />
    )
    expect(html).toContain('min-h-11')
    expect(html).toContain('-my-3')
  })

  it('draws the maybe answer in its own fill rather than the committed one', () => {
    // `bg-maybe` against `bg-accent`, the same pairing `AttendancePill` ships,
    // so one answer does not read as the other between the list and the detail.
    const maybe = renderToStaticMarkup(
      <RideStatusChip attendance="maybe" open={false} onToggle={() => {}} />
    )
    const going = renderToStaticMarkup(
      <RideStatusChip attendance="going" open={false} onToggle={() => {}} />
    )
    expect(maybe).toContain('bg-maybe')
    expect(maybe).toContain('Maybe')
    expect(going).toContain('bg-accent')
    expect(going).toContain('Going')
  })

  it('draws nothing for a rider who declined or never answered', () => {
    // `setRideAttendance` deletes the row for `No`, so declined and unanswered
    // are the same stored state and neither has a chip to draw. The page does
    // not reach here in that case; this is the guard for a caller that loses
    // that gate, and it must render nothing rather than an unlabelled pill.
    expect(
      renderToStaticMarkup(<RideStatusChip attendance={null} open={false} onToggle={() => {}} />)
    ).toBe('')
  })
})
