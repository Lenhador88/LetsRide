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
 * `108` / `122`, PD-402 / PD-454 — the ride thread's ⋯ menu.
 *
 * Testable in two halves for `ThreadOptions.test.tsx`'s reason: `ContextMenu`
 * returns `null` whenever `typeof document === 'undefined'`, which is every run
 * under this suite's `environment: 'node'`, so rendering the whole
 * `RideThreadOptions` sheet would draw nothing regardless of which row is right.
 * `RideThreadOptionsRows` renders the rows directly.
 *
 * **What this file pins is an EMPTINESS property, and PD-454 changed how it
 * holds.** The club's menu argues it is structurally non-empty because
 * `isAuthor` is a boolean — either `Delete thread` or `Report thread` always
 * renders. Before PD-454 the ride's menu could not make that argument, because
 * reporting was deferred and the menu had exactly one conditional row; the
 * screen's own mount gate (`canRemoveRideThread`) was what kept a viewer with
 * neither right from seeing an empty sheet. PD-454 gives the ride the same
 * argument the club already had, and the row-set cases below are what let the
 * mount gate go — see `design.md` D11 and `thread/page.tsx`.
 */
function render(props: { isAuthor: boolean; isOrganizer: boolean }) {
  return renderToStaticMarkup(
    <RideThreadOptionsRows pending={false} onReport={noop} onDeleteClick={noop} {...props} />
  )
}

describe('RideThreadOptionsRows — the D11 table', () => {
  it('the author sees Delete thread and NOT Report thread', () => {
    const html = render({ isAuthor: true, isOrganizer: false })
    expect(html).toContain('Delete thread')
    expect(html).not.toContain('Report thread')
  })

  it('the organizer who did not author the thread sees BOTH', () => {
    const html = render({ isAuthor: false, isOrganizer: true })
    expect(html).toContain('Report thread')
    expect(html).toContain('Delete thread')
  })

  it('a plain crew member — neither author nor organizer — sees Report thread and NOT Delete thread', () => {
    // The row-set case §8.2 names: reversed, this viewer would see a control
    // that always fails — `moderate_ride_thread` refuses both of its arms for
    // them.
    const html = render({ isAuthor: false, isOrganizer: false })
    expect(html).toContain('Report thread')
    expect(html).not.toContain('Delete thread')
  })

  it('an organizer who also authored the thread sees only Delete — the narrower right renders the same row', () => {
    const html = render({ isAuthor: true, isOrganizer: true })
    expect(html).toContain('Delete thread')
    expect(html).not.toContain('Report thread')
  })

  it('no share row is drawn for any of the four combinations', () => {
    for (const isAuthor of [true, false]) {
      for (const isOrganizer of [true, false]) {
        expect(render({ isAuthor, isOrganizer })).not.toContain('Share')
      }
    }
  })
})

/**
 * The menu is never empty for any viewer — the property `design.md` D11 names
 * as what permits the mount gate's removal. Swept across all four
 * combinations rather than asserted for one, because the invariant has to
 * hold for all of them or the gate's removal was unsafe.
 */
describe('RideThreadOptionsRows — never an empty sheet', () => {
  it('always draws at least one of Report thread / Delete thread', () => {
    for (const isAuthor of [true, false]) {
      for (const isOrganizer of [true, false]) {
        const html = render({ isAuthor, isOrganizer })
        const hasRow = html.includes('Report thread') || html.includes('Delete thread')
        expect(hasRow).toBe(true)
      }
    }
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
   * nothing gets no delete row at all, and `108` refuses their delete — the two
   * have to agree, and only the RPC's refusal is enforced.
   */
  it('answers for the author, the organizer, both, and neither', () => {
    expect(canRemoveRideThread({ isAuthor: true, isOrganizer: false })).toBe(true)
    expect(canRemoveRideThread({ isAuthor: false, isOrganizer: true })).toBe(true)
    expect(canRemoveRideThread({ isAuthor: true, isOrganizer: true })).toBe(true)
    expect(canRemoveRideThread({ isAuthor: false, isOrganizer: false })).toBe(false)
  })
})

/**
 * PD-454 removes the screen's mount gate on `canRemoveRideThread` — this
 * asserts that removal happened rather than merely that the menu can no
 * longer be empty. Reversed, task 6.5's own trap: a crew member who is
 * neither the author nor the organizer would open a thread, see `Delete
 * thread` unconditionally rendered as it was before this change, tap it, and
 * `moderate_ride_thread` would refuse it — the "control that always fails"
 * this component's own header names as the thing to avoid.
 *
 * Read on comment-stripped source, `writers-invalidate.test.ts`'s technique:
 * this repo's docstrings describe the reasoning, and a docstring naming
 * `canRemoveRideThread` in prose must not satisfy a check for its absence
 * from the mount condition.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('the screen no longer gates the menu mount on canRemoveRideThread', () => {
  it('mounts RideThreadOptions on thread/ride/profile alone, not on the delete predicate', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const screen = stripComments(
      readFileSync(
        path.join(here, '../../../app/(app)/rides/detail/thread/page.tsx'),
        'utf8'
      )
    )

    // The predicate is still exported and still used inside RideThreadOptions
    // itself for the delete row — this only asserts it dropped out of the
    // SCREEN's own mount condition.
    expect(screen).not.toContain('canRemoveRideThread')
    expect(screen).toContain('thread.data && ride.data && me.data')
  })
})
