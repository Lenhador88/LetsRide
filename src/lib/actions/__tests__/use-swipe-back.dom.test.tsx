// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
/**
 * `useSwipeBack`'s WIRING, as opposed to its arithmetic — PD-341.
 *
 * **jsdom because the whole defect was in the listeners**, not in the pure
 * module beside it. `swipe-back.test.ts` had every threshold right while the
 * gesture never fired on a phone: the decision is taken at `pointerup`, and on
 * touch Chromium takes an edge drag as a pan and sends `pointercancel` about
 * 20px in, so `pointerup` never arrives. Measured with raw touch through CDP
 * against this hook, bundled from `src/`: before, `down, pointercancel`, zero
 * navigations; after, the swipe navigates and a vertical drag from the same
 * edge still scrolls.
 *
 * So what has to be pinned here is that the hook calls `preventDefault` on a
 * **non-passive `touchmove`** — the only thing that stops a pan — and only for
 * a gesture it already admitted. jsdom cannot scroll or pan, so it cannot show
 * the defect; it can show the call, which is what a later refactor would drop.
 * The CDP harness is the other half and lives in the PR.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/profile/detail',
  useSearchParams: () => new URLSearchParams(),
}))

const { useSwipeBack } = await import('@/lib/actions/navigate')
const { SWIPE_BACK_OPT_OUT } = await import('@/lib/swipe-back')

function Screen() {
  useSwipeBack('/postcards')
  return (
    <div>
      <div data-testid="plain" />
      <textarea data-testid="field" />
      <div data-testid="declined" {...{ [SWIPE_BACK_OPT_OUT]: 'off' }} />
    </div>
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  push.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Screen />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const at = (testid: string) => container.querySelector(`[data-testid="${testid}"]`) as HTMLElement

/** A pointerdown jsdom will carry: `PointerEvent` is not implemented there. */
function pointer(
  type: string,
  target: EventTarget,
  { timeStamp, ...props }: Record<string, unknown> & { timeStamp?: number }
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerType: 'touch', isPrimary: true, ...props })
  // `timeStamp` is a getter on jsdom's Event, and the hook reads it for the
  // 1200ms bound.
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

/** A `touchmove` with one moving finger, dispatched on `window`. */
function touchMove(clientX: number, clientY: number) {
  const event = new Event('touchmove', { bubbles: true, cancelable: true })
  Object.assign(event, { touches: [{ clientX, clientY }] })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('the touch claim', () => {
  it('takes a rightward drag that began in the edge zone', () => {
    pointer('pointerdown', at('plain'), { clientX: 8, clientY: 400, timeStamp: 0 })
    // The claim is what stops the browser panning; without it the gesture ends
    // in pointercancel and pointerup never arrives.
    expect(touchMove(20, 401).defaultPrevented).toBe(true)
    // Once claimed it keeps claiming, including a sample that has drifted.
    expect(touchMove(60, 430).defaultPrevented).toBe(true)
  })

  it('leaves a vertical drag to the browser, and does not come back for it', () => {
    pointer('pointerdown', at('plain'), { clientX: 8, clientY: 400, timeStamp: 0 })
    expect(touchMove(9, 380).defaultPrevented).toBe(false)
    // The gesture is dropped, so a later rightward sample cannot claim a scroll
    // already in progress.
    expect(touchMove(120, 380).defaultPrevented).toBe(false)
  })

  it('claims nothing that started outside the edge zone', () => {
    pointer('pointerdown', at('plain'), { clientX: 200, clientY: 400, timeStamp: 0 })
    expect(touchMove(320, 400).defaultPrevented).toBe(false)
  })

  it.each([
    ['a text field', 'field'],
    ['an opted-out subtree', 'declined'],
  ])('claims nothing that started on %s', (_label, testid) => {
    pointer('pointerdown', at(testid), { clientX: 8, clientY: 400, timeStamp: 0 })
    expect(touchMove(120, 400).defaultPrevented).toBe(false)
  })

  it('claims nothing while a modal is open', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)

    pointer('pointerdown', at('plain'), { clientX: 8, clientY: 400, timeStamp: 0 })
    expect(touchMove(120, 400).defaultPrevented).toBe(false)

    dialog.remove()
  })

  it('drops a second finger rather than claiming a pinch', () => {
    pointer('pointerdown', at('plain'), { clientX: 8, clientY: 400, timeStamp: 0 })
    const pinch = new Event('touchmove', { bubbles: true, cancelable: true })
    Object.assign(pinch, { touches: [{ clientX: 20, clientY: 400 }, { clientX: 300, clientY: 400 }] })
    act(() => {
      window.dispatchEvent(pinch)
    })
    expect(pinch.defaultPrevented).toBe(false)
    // And the gesture is gone, so the rest of the pinch cannot navigate.
    expect(touchMove(140, 400).defaultPrevented).toBe(false)
  })

  it('still navigates on the release, which is the decision the claim protects', () => {
    pointer('pointerdown', at('plain'), { clientX: 8, clientY: 400, timeStamp: 0 })
    touchMove(20, 401)
    pointer('pointerup', at('plain'), { clientX: 140, clientY: 404, timeStamp: 300 })
    expect(push).toHaveBeenCalledWith('/postcards')
  })

  it('does not navigate when the release did not qualify', () => {
    pointer('pointerdown', at('plain'), { clientX: 8, clientY: 400, timeStamp: 0 })
    touchMove(20, 401)
    pointer('pointerup', at('plain'), { clientX: 40, clientY: 404, timeStamp: 900 })
    expect(push).not.toHaveBeenCalled()
  })
})
