// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BannerProvider } from '@/components/ui/Banner'

/**
 * `onRemoved` — PD-375, `design.md` §D4's explicit removal trigger. The club
 * timeline's own first-window refetch signal can only see a removal inside
 * the interval the first page covers, so a Hide, Block **or Delete** acting
 * on a row that exists only on a deeper page needs the control that KNOWS to
 * say so itself. This is the one place that wiring is pinned end to end —
 * nothing else in the repo exercised `PostcardMenu` through an actual click
 * before this file existed.
 *
 * **Delete was the finding**: it is the same class of removal Hide and Block
 * already reported, and it did not. Verified both ways per CLAUDE.md
 * §Working Principles — dropping `{ removes: true }` from the Delete call
 * site fails 'fires onRemoved after a successful delete of your own
 * postcard' below and passes every other case unchanged, which is what
 * proves the assertion is pinned to Delete specifically rather than to
 * `run()`'s plumbing in general.
 *
 * jsdom, not `renderToStaticMarkup`: `ContextMenu` portals its sheet to
 * `document.body` only once `open` is true, which needs a real click to
 * reach, and `run()`'s `startTransition(async () => {...})` needs real
 * effects and microtasks to settle — `ClubTimeline.test.tsx`'s own reason
 * for the same choice.
 */

let root: Root | null = null
let container: HTMLElement | null = null

const {
  hidePostcardMock,
  blockRiderMock,
  deletePostcardMock,
  reportPostcardMock,
} = vi.hoisted(() => ({
  hidePostcardMock: vi.fn(async (): Promise<{ error: string | null }> => ({ error: null })),
  blockRiderMock: vi.fn(async (): Promise<{ error: string | null }> => ({ error: null })),
  deletePostcardMock: vi.fn(async (): Promise<{ error: string | null }> => ({ error: null })),
  reportPostcardMock: vi.fn(async (): Promise<{ error: string | null }> => ({ error: null })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/postcards',
}))

vi.mock('@/lib/actions/blocks', () => ({ blockRider: blockRiderMock }))
vi.mock('@/lib/actions/moderation', () => ({
  hidePostcard: hidePostcardMock,
  reportPostcard: reportPostcardMock,
}))
vi.mock('@/lib/actions/postcards', () => ({ deletePostcard: deletePostcardMock }))

const { PostcardMenu } = await import('@/components/postcards/PostcardMenu')

function mount(props: { isOwn: boolean; onRemoved: () => void }) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <BannerProvider>
        <PostcardMenu
          postcardId="p1"
          authorId="a1"
          authorName="Rider"
          isOwn={props.isOwn}
          onRemoved={props.onRemoved}
        />
      </BannerProvider>
    )
  })
  return container
}

async function click(el: Element | null) {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

function openMenu() {
  return click(container!.querySelector('button[aria-haspopup="dialog"]'))
}

function sheetButton(label: string): Element | null {
  return [...document.body.querySelectorAll('[role="dialog"] button')].find(
    (button) => button.textContent === label
  ) ?? null
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  // `ContextMenu` portals into `document.body` and does not clean up its own
  // markup synchronously on every path in this harness — clear it between
  // tests so a stale sheet from one test cannot satisfy another's query.
  document.body.innerHTML = ''
})

describe('PostcardMenu — onRemoved fires for every action that removes the row', () => {
  it('fires onRemoved after a successful Hide, on someone else\'s postcard', async () => {
    const onRemoved = vi.fn()
    mount({ isOwn: false, onRemoved })

    await openMenu()
    await click(sheetButton('Hide postcard for me'))

    expect(hidePostcardMock).toHaveBeenCalledWith('p1')
    expect(onRemoved).toHaveBeenCalledTimes(1)
  })

  it('fires onRemoved after a successful Block, on someone else\'s postcard', async () => {
    const onRemoved = vi.fn()
    mount({ isOwn: false, onRemoved })

    await openMenu()
    await click(sheetButton('Block account'))

    expect(blockRiderMock).toHaveBeenCalledWith('a1')
    expect(onRemoved).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onRemoved after a Report — reporting leaves the postcard visible', async () => {
    const onRemoved = vi.fn()
    mount({ isOwn: false, onRemoved })

    await openMenu()
    await click(sheetButton('Report post'))

    expect(reportPostcardMock).toHaveBeenCalled()
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('fires onRemoved after a successful delete of your own postcard — the finding this file exists for', async () => {
    const onRemoved = vi.fn()
    mount({ isOwn: true, onRemoved })

    await openMenu()
    // Two taps — `run()` only fires on the SECOND, once `confirmingDelete` is
    // already true.
    await click(sheetButton('Delete postcard'))
    expect(deletePostcardMock).not.toHaveBeenCalled()
    await click(sheetButton('Tap again to delete'))

    expect(deletePostcardMock).toHaveBeenCalledWith('p1')
    expect(onRemoved).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onRemoved when the removal action itself fails', async () => {
    hidePostcardMock.mockImplementationOnce(async () => ({ error: 'nope' }))
    const onRemoved = vi.fn()
    mount({ isOwn: false, onRemoved })

    await openMenu()
    await click(sheetButton('Hide postcard for me'))

    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('costs nothing when the caller passes no onRemoved at all', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <BannerProvider>
          <PostcardMenu postcardId="p1" authorId="a1" authorName="Rider" isOwn={false} />
        </BannerProvider>
      )
    })

    await openMenu()
    await expect(click(sheetButton('Hide postcard for me'))).resolves.toBeUndefined()
    expect(hidePostcardMock).toHaveBeenCalledWith('p1')
  })
})
