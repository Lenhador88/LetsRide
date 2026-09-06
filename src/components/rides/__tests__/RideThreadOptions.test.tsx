import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { RideThreadOptionsRows, canRemoveRideThread } = await import(
  '@/components/rides/RideThreadOptions'
)

const noop = () => {}

/**
 * `108`, PD-402 — the ride thread's ⋯ menu.
 *
 * Testable in two halves for `ThreadOptions.test.tsx`'s reason: `ContextMenu`
 * returns `null` whenever `typeof document === 'undefined'`, which is every run
 * under this suite's `environment: 'node'`, so rendering the whole
 * `RideThreadOptions` sheet would draw nothing regardless of which row is right.
 * `RideThreadOptionsRows` renders the rows directly.
 *
 * **What this file pins is an EMPTINESS property, and it is the one thing here
 * that no other gate can see.** The club's menu argues it is structurally
 * non-empty — `isAuthor` is a boolean, so either `Delete thread` or `Report
 * thread` always renders. The ride's cannot make that argument: reporting is
 * deferred (`proposal.md` Q4), so the menu has exactly one conditional row and
 * a viewer who is neither the thread's author nor the ride's organizer would
 * get a dots icon opening an empty sheet — which
 * `docs/reference/design-system.md` §The ⋯ options menu calls worse than the
 * icon's absence.
 *
 * What stops it is that the SCREEN does not mount the menu for that viewer, on
 * the same predicate the menu itself would use. Two expressions in two files
 * agreeing is exactly the shape that drifts, so `canRemoveRideThread` is the
 * one expression and both read it.
 */
function render() {
  return renderToStaticMarkup(
    <RideThreadOptionsRows pending={false} onDeleteClick={noop} />
  )
}

describe('RideThreadOptionsRows', () => {
  it('draws Delete thread and nothing else', () => {
    const html = render()
    expect(html).toContain('Delete thread')
    // **Report is ASSERTED ABSENT rather than simply not asserted present.**
    // Q4 defers it deliberately, and an absence is invisible to a test that
    // only checks what rendered — so the day somebody ports `094`'s report row
    // across without its `club_thread_reports` table, this is what says so.
    expect(html).not.toContain('Report thread')
    // No share row either: a ride thread is not shareable to anyone who is not
    // already crew, so a share affordance would mint a link every recipient is
    // refused.
    expect(html).not.toContain('Share')
  })

  it('never renders nothing, which is why the caller must gate on canRemoveRideThread', () => {
    // The rows component itself is unconditional — it has no viewer predicate
    // at all. That is deliberate and it is what makes the gate the CALLER's
    // job: a component that quietly rendered nothing for the wrong viewer would
    // put the empty sheet behind the icon instead of removing the icon.
    expect(render().trim()).not.toBe('')
  })
})

describe('canRemoveRideThread', () => {
  /**
   * The truth table, exhaustive over the two inputs. It mirrors
   * `moderate_ride_thread`'s two authority arms — `rides.organizer_id =
   * auth.uid() OR ride_threads.author_id = auth.uid()` — and must keep
   * mirroring them: this is a display hint and the RPC re-checks both in its own
   * body, so a wrong answer here draws a control the database refuses rather
   * than opening a hole.
   *
   * **The false row is the one that matters.** A crew member who authored
   * nothing gets no menu at all, and `108` refuses their delete — the two have
   * to agree, and only the RPC's refusal is enforced.
   */
  it('answers for the author, the organizer, both, and neither', () => {
    expect(canRemoveRideThread({ isAuthor: true, isOrganizer: false })).toBe(true)
    expect(canRemoveRideThread({ isAuthor: false, isOrganizer: true })).toBe(true)
    expect(canRemoveRideThread({ isAuthor: true, isOrganizer: true })).toBe(true)
    expect(canRemoveRideThread({ isAuthor: false, isOrganizer: false })).toBe(false)
  })
})

/**
 * The screen and the menu must read the SAME expression, and a render test
 * cannot see that — both files would still compile, and the screen would still
 * draw a menu, if one of them re-derived `isAuthor || isOrganizer` inline.
 *
 * So this reads the source. It is the same technique
 * `src/lib/actions/__tests__/writers-invalidate.test.ts` uses to assert that
 * every stamp writer invalidates the guard cache: a structural claim about the
 * code, checked on the code.
 */
describe('the screen gates its trigger on the same expression', () => {
  it('imports canRemoveRideThread rather than re-deriving the predicate', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const screen = readFileSync(
      path.join(here, '../../../app/(app)/rides/detail/thread/page.tsx'),
      'utf8'
    )

    expect(screen).toContain('canRemoveRideThread')
    // Verified BOTH ways, per CLAUDE.md §Working Principles: the filter has to
    // catch a real instance as well as read clean now. Re-deriving the
    // predicate inline is what this refuses, and it is what a tidy-up reaches
    // for — the expression is two words long.
    expect(screen).not.toMatch(/isAuthor\s*\|\|\s*isOrganizer/)
  })
})
