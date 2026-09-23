// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Postcard, Profile } from '@/types'

/**
 * PD-475: a downward drag that begins inside the open postcard closes it.
 *
 * **jsdom rather than `renderToStaticMarkup`, and the reason is the gesture.**
 * The whole feature lives in `pointerdown`/`pointermove`/`pointerup` handlers
 * and a real `scrollTop`, none of which exist under this repo's default
 * `environment: 'node'`.
 *
 * `Element.prototype.setPointerCapture` does not exist in jsdom at all
 * (`el.setPointerCapture is not a function` — measured, not assumed) and the
 * component calls it unconditionally once a gesture arms, exactly as
 * `PostcardDeck` calls it for its own horizontal drag with no guard either.
 * Stubbed here rather than made defensive in production code, the same way
 * `CountrySelect.test.tsx` and `ClubTimeline.test.tsx` stub the equally
 * jsdom-absent `scrollIntoView`.
 */
Element.prototype.setPointerCapture = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/postcards',
}))

const POSTCARD_ID = '11111111-1111-4111-8111-111111111111'

const POSTCARD: Postcard = {
  id: POSTCARD_ID,
  author_id: '22222222-2222-4222-8222-222222222222',
  club_id: null,
  image_path: 'rider/photo.jpg',
  caption: 'Coffee stop',
  created_at: '2026-08-01T09:00:00Z',
  updated_at: '2026-08-01T09:00:00Z',
  taken_place_name: null,
  taken_country_code: null,
  image_url: null,
  author: {
    id: '22222222-2222-4222-8222-222222222222',
    username: 'pedro',
    avatar_url: null,
  } as Postcard['author'],
}

const PROFILE = { id: '22222222-2222-4222-8222-222222222222' } as Profile

/**
 * Stands in for the whole cache: `combineQueries` is kept real (a pure
 * function over the three results below), and only `useQuery` itself is
 * replaced, matching `RideCrewRail.dom.test.tsx`'s own reason — nothing here
 * is testing the fetch, only what renders once it has answered.
 */
vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    useQuery: (key: readonly unknown[] | null) => {
      const settled = { error: null, isLoading: false, isRefetching: false, refetch: vi.fn() }
      if (key === null) return { data: undefined, ...settled }
      if (key[0] === 'profile') return { data: PROFILE, ...settled }
      if (key.length === 4) return { data: [], ...settled }
      return { data: POSTCARD, ...settled }
    },
  }
})

const { PostcardViewerProvider } = await import('@/components/postcards/PostcardViewer')
const { usePostcardViewer } = await import('@/components/postcards/viewerContext')
const { BannerProvider } = await import('@/components/ui/Banner')

/** The one way in — `usePostcardViewer()` — driven from a plain button so
 * each test opens the dialog the same way a real card does. */
function OpenTrigger() {
  const open = usePostcardViewer()
  return (
    <button type="button" onClick={() => open?.(POSTCARD_ID)}>
      open
    </button>
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <BannerProvider>
        <PostcardViewerProvider>
          <OpenTrigger />
        </PostcardViewerProvider>
      </BannerProvider>
    )
  })
  act(() => {
    container.querySelector('button')!.click()
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.querySelectorAll('[data-fake-overlay]').forEach((el) => el.remove())
  vi.clearAllMocks()
})

function panel(): HTMLElement {
  const el = document.querySelector('[role="dialog"][aria-label="Postcard"]')
  if (!el) throw new Error('The postcard dialog did not open.')
  return el as HTMLElement
}

function scroller(): HTMLElement {
  // The one scrollable child of the panel — see the panel's own `ref={scrollerRef}` comment.
  return panel().querySelector(':scope > div:last-child') as HTMLElement
}

function isOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-label="Postcard"]') !== null
}

/** `pointerId` is fixed at 1 throughout — nothing here tests multi-touch.
 * `timeStamp` is not a constructible `PointerEventInit` property, so a caller
 * wanting to simulate elapsed time overrides it afterwards — see `at`. */
function pointerEvent(
  type: string,
  x: number,
  y: number,
  overrides: Partial<PointerEventInit> & { at?: number } = {}
) {
  const { at, ...init } = overrides
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
    ...init,
  })
  if (at !== undefined) Object.defineProperty(event, 'timeStamp', { value: at })
  return event
}

/** A full down → far move → up sequence, on whichever element the gesture
 * begins on — real elements bubble, and the panel's own handlers are what
 * this file exists to exercise. */
function drag(target: Element, dx: number, dy: number) {
  act(() => {
    target.dispatchEvent(pointerEvent('pointerdown', 100, 300))
    target.dispatchEvent(pointerEvent('pointermove', 100 + dx, 300 + dy))
    target.dispatchEvent(pointerEvent('pointerup', 100 + dx, 300 + dy))
  })
}

/** One moving finger, dispatched on the panel the native listener is bound to. */
function touchMove(x: number, y: number) {
  const event = new Event('touchmove', { bubbles: true, cancelable: true })
  Object.assign(event, { touches: [{ clientX: x, clientY: y }] })
  act(() => {
    panel().dispatchEvent(event)
  })
  return event
}

/**
 * **The native `touchmove` listener, which is the entire fix and had no gate.**
 *
 * The first review measured the shipped gesture dying on touch: Chromium takes
 * the pull as a pan and sends `pointercancel` about 20px in, so `pointerup`
 * never arrives. Only a non-passive `touchmove` listener's own
 * `preventDefault` stops that. Deleting the effect left every other test in
 * this file green, which is what these cases close.
 *
 * jsdom cannot pan, so what is pinned here is the CALL — the thing a refactor
 * drops. The browser measurement lives in the PR.
 */
describe('PostcardViewerDialog — claiming the touch from the browser', () => {
  it('claims a downward sample before the gesture has even armed', () => {
    act(() => {
      panel().querySelector('h2')!.dispatchEvent(pointerEvent('pointerdown', 100, 300))
    })
    // Two pixels: below `SWIPE_DISMISS_ARM_PX`, and still claimed, because the
    // browser commits to its pan without waiting for that slop.
    expect(touchMove(100, 302).defaultPrevented).toBe(true)
  })

  it('keeps claiming once armed, including a sample that drifts sideways', () => {
    act(() => {
      panel().querySelector('h2')!.dispatchEvent(pointerEvent('pointerdown', 100, 300))
      panel().querySelector('h2')!.dispatchEvent(pointerEvent('pointermove', 100, 340))
    })
    expect(touchMove(130, 380).defaultPrevented).toBe(true)
  })

  it('claims nothing when the gesture was declined at pointerdown', () => {
    const s = scroller()
    s.scrollTop = 30
    act(() => {
      s.dispatchEvent(pointerEvent('pointerdown', 100, 300))
    })
    // The scroller had room, so this pull is its own — and the listener must
    // not take it, or the thread stops scrolling.
    expect(touchMove(100, 340).defaultPrevented).toBe(false)
  })

  it('claims nothing on an upward sample', () => {
    act(() => {
      panel().querySelector('h2')!.dispatchEvent(pointerEvent('pointerdown', 100, 300))
    })
    expect(touchMove(100, 260).defaultPrevented).toBe(false)
  })

  it('claims nothing after the gesture has ended', () => {
    act(() => {
      panel().querySelector('h2')!.dispatchEvent(pointerEvent('pointerdown', 100, 300))
      panel().querySelector('h2')!.dispatchEvent(pointerEvent('pointerup', 100, 302))
    })
    expect(touchMove(100, 340).defaultPrevented).toBe(false)
  })
})

describe('PostcardViewerDialog — a downward drag from inside the panel', () => {
  it('closes on a strong, dominant, downward pull starting on ordinary content, at scrollTop 0', () => {
    expect(isOpen()).toBe(true)
    drag(panel().querySelector('h2')!, 0, 140)
    expect(isOpen()).toBe(false)
  })

  // A thumb resting on the panel before it starts pulling must not spend
  // `SWIPE_DISMISS_MAX_MS` on time nobody moved — the clock is re-based to
  // the moment of arming, not left at `pointerdown`'s timestamp.
  it('still closes after a long rest, as long as the pull itself is quick', () => {
    // `at` starts at `1000` rather than `0`: React's `SyntheticEvent` falls
    // back to `Date.now()` for a falsy `nativeEvent.timeStamp` (measured —
    // `0` was silently discarded), so the base has to be non-zero for the
    // override to survive at all.
    const header = panel().querySelector('h2')!
    act(() => {
      header.dispatchEvent(pointerEvent('pointerdown', 100, 300, { at: 1000 }))
      // 2 seconds of doing nothing — comfortably past `SWIPE_DISMISS_MAX_MS`
      // if measured from `pointerdown`.
      header.dispatchEvent(pointerEvent('pointermove', 100, 440, { at: 3000 }))
      header.dispatchEvent(pointerEvent('pointerup', 100, 440, { at: 3050 }))
    })
    expect(isOpen()).toBe(false)
  })

  // A real touch device cannot deliver the opposite of this test: once a
  // gesture starts with `scrollTop > 0`, this component deliberately never
  // suppresses the native scroll, so Chromium claims the touch for its own
  // pan and ends the pointer sequence in `pointercancel` — there is no later
  // `pointermove` in which to notice the scroller reaching its top. An
  // earlier version of this file asserted the opposite (a continuous drag
  // switching from scroll to dismiss mid-gesture) and it only ever passed
  // because jsdom has no such cancellation; `swipe-dismiss.ts`'s header and
  // `openspec/specs/postcard-viewer-dismissal/spec.md` both carry the
  // corrected rule this test pins.
  it('never dismisses a gesture that started while the scroller had room, even if it reaches the top before release', () => {
    const s = scroller()
    s.scrollTop = 30

    act(() => {
      s.dispatchEvent(pointerEvent('pointerdown', 100, 300))
    })
    expect(isOpen()).toBe(true)

    // The scroller reaches its top before release — on a real device this
    // pointer sequence would already be dead (`pointercancel`); here it is
    // simulated as still receiving events, which is the more generous case
    // for the behaviour under test and still must not dismiss.
    s.scrollTop = 0

    act(() => {
      s.dispatchEvent(pointerEvent('pointermove', 100, 300 + 150))
      s.dispatchEvent(pointerEvent('pointerup', 100, 300 + 150))
    })

    expect(isOpen()).toBe(true)
    expect(panel().style.transform).toBe('')
  })

  it('springs back to rest when an armed drag is abandoned short of the threshold', () => {
    // Clears `SWIPE_DISMISS_ARM_PX` (so the panel follows the finger) but
    // stays under both `SWIPE_DISMISS_FLICK_PX` and `_DISTANCE_PX`, so it
    // cannot dismiss whatever the (near-zero, synchronous-dispatch) elapsed
    // time comes out to.
    drag(panel().querySelector('h2')!, 0, 20)

    expect(isOpen()).toBe(true)
    // The transform this drag set while tracking is cleared again on release.
    expect(panel().style.transform).toBe('')
  })

  it('does not dismiss while the scroller has anywhere to go, however hard the pull', () => {
    scroller().scrollTop = 50

    drag(scroller(), 0, 400)

    expect(isOpen()).toBe(true)
    // Nothing armed, so the panel never left its resting position.
    expect(panel().style.transform).toBe('')
  })

  it('declines a gesture that starts on a control, and the control keeps its click', () => {
    const close = [...panel().querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Close'
    )!

    drag(close, 0, 400)

    // The drag itself dismissed nothing…
    expect(isOpen()).toBe(true)

    // …and the button's own click still works, because the gesture was
    // declined before any pointer capture could retarget it.
    act(() => close.click())
    expect(isOpen()).toBe(false)
  })

  // Named for `isTopmost`'s own nesting rule, which Escape already follows —
  // not PD-339, which is the separate scrim-tap-vs-panel-drag rule the next
  // test pins.
  it('dismisses nothing underneath a topmost overlay (the postcard menu, the same nesting rule Escape follows)', () => {
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('data-fake-overlay', '')
    document.body.appendChild(overlay)

    drag(panel().querySelector('h2')!, 0, 400)

    expect(isOpen()).toBe(true)
  })

  it('closes nothing on an upward drag, at any scroll position', () => {
    drag(panel().querySelector('h2')!, 0, -400)
    expect(isOpen()).toBe(true)

    scroller().scrollTop = 50
    drag(panel().querySelector('h2')!, 0, -400)
    expect(isOpen()).toBe(true)
  })

  it('closes nothing on a mostly-horizontal drag over the postcard card', () => {
    const article = panel().querySelector('article')!
    drag(article, 140, 20)
    expect(isOpen()).toBe(true)
  })

  // The case above alone stays green if the axis-ratio check is deleted
  // entirely: `dy: 20` is under `SWIPE_DISMISS_FLICK_PX` regardless of
  // dominance, so removing dominance cannot make it dismiss. This one is
  // long enough on its own (`dy` clears `SWIPE_DISMISS_DISTANCE_PX`) that
  // only the axis check stands between it and closing.
  it('closes nothing on a long horizontal drag, even though its vertical travel alone would qualify', () => {
    const article = panel().querySelector('article')!
    drag(article, 400, 100)
    expect(isOpen()).toBe(true)
  })

  it('never dismisses on a mouse-driven drag', () => {
    act(() => {
      const target = panel().querySelector('h2')!
      target.dispatchEvent(pointerEvent('pointerdown', 100, 300, { pointerType: 'mouse' }))
      target.dispatchEvent(pointerEvent('pointermove', 100, 440, { pointerType: 'mouse' }))
      target.dispatchEvent(pointerEvent('pointerup', 100, 440, { pointerType: 'mouse' }))
    })
    expect(isOpen()).toBe(true)
  })

  it('a cancel never closes the popup and always springs back', () => {
    const header = panel().querySelector('h2')!
    act(() => {
      header.dispatchEvent(pointerEvent('pointerdown', 100, 300))
      // Far enough to arm — the panel is now following the finger.
      header.dispatchEvent(pointerEvent('pointermove', 100, 440))
    })
    expect(panel().style.transform).not.toBe('')

    act(() => {
      header.dispatchEvent(pointerEvent('pointercancel', 100, 440))
    })

    expect(isOpen()).toBe(true)
    expect(panel().style.transform).toBe('')
  })

  // PD-339: the scrim only dismisses a gesture whose OWN `pointerdown` landed
  // on it. A drag that began inside the panel must never be re-judged as a
  // scrim tap merely because it is released over the strip of scrim PD-339
  // leaves above the panel.
  it('does not retrigger the scrim tap-to-dismiss for a panel drag released over the scrim strip', () => {
    const scrim = panel().previousElementSibling as HTMLElement
    const header = panel().querySelector('h2')!

    act(() => {
      // Too weak to qualify as a dismiss on its own — the point is only that
      // the scrim's own click handler must not additionally fire.
      header.dispatchEvent(pointerEvent('pointerdown', 100, 300))
      header.dispatchEvent(pointerEvent('pointerup', 100, 300))
      // The browser's own synthetic click after a release "over" the scrim,
      // which `scrimArmed` is what makes inert for a gesture that began here.
      scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(isOpen()).toBe(true)
  })

  it('leaves Escape and the Close button as the exits, and adds no role or tabIndex', () => {
    expect(panel().getAttribute('role')).toBe('dialog')
    expect(panel().getAttribute('aria-modal')).toBe('true')
    expect(panel().getAttribute('tabindex')).toBe('-1')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(isOpen()).toBe(false)
  })
})
