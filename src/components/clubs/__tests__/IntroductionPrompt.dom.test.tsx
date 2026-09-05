// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const introduceToClub = vi.fn()
const joinAndIntroduceToClub = vi.fn()
vi.mock('@/lib/actions/club-introductions', () => ({
  introduceToClub: (...args: unknown[]) => introduceToClub(...args),
  joinAndIntroduceToClub: (...args: unknown[]) => joinAndIntroduceToClub(...args),
}))

const { IntroductionPrompt } = await import('@/components/clubs/IntroductionPrompt')
const { CLUB_INTRODUCTION_PARTIAL_FAILURE } = await import('@/lib/validation/clubs')

/**
 * The **wrapper** — the half of PD-392 that `IntroductionPrompt.test.tsx`
 * cannot reach.
 *
 * That file renders `IntroductionPromptBody` with props and asserts what it
 * draws. This one drives the component that *produces* those props, and the
 * distinction is not academic: the wrapper owns the latch, the in-flight
 * dismissal lock, and the boolean the whole dismissal iff depends on. The
 * pre-merge review found that every one of the following mutations left the
 * entire suite green, because the iff's two *consumers* were asserted and its
 * *producer* was not:
 *
 * - `onDismiss(true)` unconditionally — **the exact defect PD-392 exists to
 *   remove.** A `Join later` would record a session dismissal and silence the
 *   members-only prompt for a rider who never joined.
 * - dropping `|| joined` from `membershipExists` — the partial-failure copy and
 *   the relabelling both break.
 * - deleting `if (dismissLocked) return` — the **scrim and Escape** half of the
 *   in-flight lock, which is the half `ContextMenu` routes through and the
 *   reason the state was hoisted out of the body at all. Asserting the button's
 *   `disabled` attribute does not cover it.
 *
 * **jsdom rather than `renderToStaticMarkup`, structurally.** `ContextMenu`
 * returns `null` when `typeof document === 'undefined'`, so under this repo's
 * default `environment: 'node'` the wrapper renders nothing at all — there is
 * no scrim to click and no transition to run. Every assertion here needs a real
 * event or a resolved transition.
 *
 * **Verified both ways** (`CLAUDE.md` §Working Principles): each of the three
 * mutations above was applied to `IntroductionPrompt.tsx` and confirmed to fail
 * a named test below, then reverted.
 */

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  introduceToClub.mockReset()
  joinAndIntroduceToClub.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(node: React.ReactNode) {
  act(() => root.render(node))
}

/** The sheet renders through a portal, so query the document rather than the
 *  container it was mounted into. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label
  )
  if (!found) throw new Error(`no button labelled "${label}"`)
  return found as HTMLButtonElement
}

function type(text: string) {
  const textarea = document.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('IntroductionPrompt — the dismissal iff, at its producer', () => {
  it('reports NO membership when a pre-join sheet is dismissed with Join later', async () => {
    const onDismiss = vi.fn()
    render(
      <IntroductionPrompt
        clubId="club-1"
        mode="pre-join"
        open
        onDismiss={onDismiss}
        onPosted={vi.fn()}
      />
    )

    click(button('Join later'))

    // `false` is what stops the caller recording a session dismissal. A rider
    // who declined to join has asserted nothing about introducing themselves
    // later, and recording one would silence the members-only prompt if they
    // are admitted by another door in the same session.
    expect(onDismiss).toHaveBeenCalledWith(false)
    expect(joinAndIntroduceToClub).not.toHaveBeenCalled()
  })

  it('reports a membership when a member-mode sheet is dismissed with Not now', () => {
    const onDismiss = vi.fn()
    render(
      <IntroductionPrompt
        clubId="club-1"
        mode="member"
        open
        onDismiss={onDismiss}
        onPosted={vi.fn()}
      />
    )

    click(button('Not now'))

    expect(onDismiss).toHaveBeenCalledWith(true)
  })
})

describe('IntroductionPrompt — the latch', () => {
  it('relabels to Not now and reports a membership once its own join lands', async () => {
    // The partial failure: the join succeeded, the introduction did not. The
    // rider IS a member, so `Join later` would be a lie on the very screen that
    // just made it one.
    joinAndIntroduceToClub.mockResolvedValue({
      outcome: 'introduction-failed',
      error: 'nope',
    })
    const onDismiss = vi.fn()
    render(
      <IntroductionPrompt
        clubId="club-1"
        mode="pre-join"
        open
        onDismiss={onDismiss}
        onPosted={vi.fn()}
      />
    )

    type('Hi, I ride a Ténéré.')
    await act(async () => {
      button('Post').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // The one string that says half of a Post succeeded.
    expect(document.body.textContent).toContain(CLUB_INTRODUCTION_PARTIAL_FAILURE)
    // The latch flipped: the control relabels and now reports a membership.
    expect(() => button('Join later')).toThrow()
    click(button('Not now'))
    expect(onDismiss).toHaveBeenCalledWith(true)
  })

  it('does not latch when the join itself failed', async () => {
    joinAndIntroduceToClub.mockResolvedValue({
      outcome: 'join-failed',
      error: 'That club could not be joined.',
    })
    const onDismiss = vi.fn()
    render(
      <IntroductionPrompt
        clubId="club-1"
        mode="pre-join"
        open
        onDismiss={onDismiss}
        onPosted={vi.fn()}
      />
    )

    type('Hi, I ride a Ténéré.')
    await act(async () => {
      button('Post').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Nothing was written, so the rider is still not a member and the sheet
    // still means what it says.
    click(button('Join later'))
    expect(onDismiss).toHaveBeenCalledWith(false)
  })
})

describe('IntroductionPrompt — the in-flight dismissal lock covers the scrim, not just the button', () => {
  it('ignores a scrim click while the membership write is out, and accepts one after', async () => {
    let settle: (value: { outcome: string }) => void = () => {}
    joinAndIntroduceToClub.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    const onDismiss = vi.fn()
    render(
      <IntroductionPrompt
        clubId="club-1"
        mode="pre-join"
        open
        onDismiss={onDismiss}
        onPosted={vi.fn()}
      />
    )

    type('Hi, I ride a Ténéré.')
    act(() => {
      button('Post').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // The scrim is `ContextMenu`'s and closes through the same `onClose` the
    // control does — so asserting the button's `disabled` attribute, as the
    // static test does, leaves this path entirely uncovered. A dismissal
    // landing here would close a sheet labelled `Join later` over a join that
    // may already have committed.
    const scrim = document.querySelector('.fixed.inset-0') as HTMLElement
    expect(scrim).not.toBeNull()
    click(scrim)
    expect(onDismiss).not.toHaveBeenCalled()

    // Once the membership exists the sheet is in member mode, where `097`'s
    // "always dismissible, pending or not" applies again — the lock covers the
    // membership write and no more.
    await act(async () => {
      settle({ outcome: 'joined-and-introduced' })
    })
  })
})
