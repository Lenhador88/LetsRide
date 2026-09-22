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

/** `pointerId` is fixed at 1 throughout — nothing here tests multi-touch. */
function pointerEvent(
  type: string,
  x: number,
  y: number,
  overrides: Partial<PointerEventInit> = {}
) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
    ...overrides,
  })
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

describe('PostcardViewerDialog — a downward drag from inside the panel', () => {
  it('closes on a strong, dominant, downward pull starting on ordinary content, at scrollTop 0', () => {
    expect(isOpen()).toBe(true)
    drag(panel().querySelector('h2')!, 0, 140)
    expect(isOpen()).toBe(false)
  })

  it('lets one continuous drag switch from scrolling to dismissing once the scroller runs out of room', () => {
    const s = scroller()
    s.scrollTop = 30

    act(() => {
      s.dispatchEvent(pointerEvent('pointerdown', 100, 300))
      // Still scrolling: re-baselines the start point rather than arming.
      s.dispatchEvent(pointerEvent('pointermove', 100, 320))
    })
    expect(isOpen()).toBe(true)

    // The scroller has now reached its top mid-gesture (simulated directly,
    // as the native scroll this drag would otherwise have driven).
    s.scrollTop = 0

    act(() => {
      // Travel measured from the re-baselined point (100, 320), not from the
      // original pointerdown — comfortably past `SWIPE_DISMISS_DISTANCE_PX`.
      s.dispatchEvent(pointerEvent('pointermove', 100, 320 + 150))
      s.dispatchEvent(pointerEvent('pointerup', 100, 320 + 150))
    })

    expect(isOpen()).toBe(false)
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

  it('dismisses nothing underneath a topmost overlay (the postcard menu, PD-339s isTopmost rule)', () => {
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
