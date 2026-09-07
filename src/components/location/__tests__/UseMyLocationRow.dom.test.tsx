// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deviceLocationPermission = vi.fn()
const requestDeviceLocation = vi.fn()
vi.mock('@/lib/location/rider-location', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/location/rider-location')>()),
  deviceLocationPermission: () => deviceLocationPermission(),
  requestDeviceLocation: () => requestDeviceLocation(),
}))

// The sheet reaches the network through `PlaceSearchField`; nothing here opens
// it, and stubbing it keeps this file about the row's own decisions.
vi.mock('@/components/location/TownQuestionSheet', () => ({
  TownQuestionSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="town-sheet" /> : null,
}))

const { UseMyLocationRow } = await import('@/components/location/UseMyLocationRow')
const { resetAskedForLocationForTests } = await import('@/lib/location/ask-once')

/**
 * The row's own decisions — PD-419.
 *
 * **`locationPrimingState` is tested separately and exhaustively**; what cannot
 * be reached from there is what this file owns: the automatic ask and the flag
 * it spends, the label the `refine` state draws, and the hand-off between the
 * two sheets.
 *
 * **jsdom rather than `renderToStaticMarkup`, structurally.** The permission
 * read is a promise resolved in a mounted effect and the automatic ask is a
 * second effect keyed off its result, so under `environment: 'node'` this
 * component renders `null` for ever and every assertion below would pass
 * against a component that does nothing.
 *
 * Verified both ways: marking the ask on the rider's ANSWER rather than on the
 * open fails *spends the ask on opening*; dropping the `auto` guard fails *a
 * tab root never opens a sheet by itself*; returning `hidden` for a
 * profile-derived position fails the `refine` label assertions.
 */

const PROFILE = { lat: 52.09, lon: 5.12, source: 'profile' as const }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  deviceLocationPermission.mockReset()
  requestDeviceLocation.mockReset()
  deviceLocationPermission.mockResolvedValue('prompt')
  resetAskedForLocationForTests()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root.unmount())
  container.remove()
  resetAskedForLocationForTests()
})

/** Mounts and lets the permission effect settle. Does NOT run the automatic
 *  ask's beat — `beat()` below is what does, so every test says whether it
 *  waited. */
async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

/** Runs out `AUTO_ASK_DELAY_MS`. Fake timers, so the beat is a decision the
 *  test makes rather than a real 700ms it sleeps through. */
async function beat() {
  await act(async () => {
    vi.advanceTimersByTime(1_000)
  })
}

const sheet = () => document.querySelector('[role="dialog"]')
const rowLabel = () => container.querySelector('button span')?.textContent

describe('the automatic ask — once, ever', () => {
  it('opens the priming sheet by itself on a screen that passes auto', async () => {
    await render(<UseMyLocationRow position={null} auto />)
    await beat()
    expect(sheet()).not.toBeNull()
  })

  it('a tab root never opens a sheet by itself', async () => {
    // The reason for asking is not on screen at a tab root, and a sheet that
    // appears there teaches riders to dismiss permission prompts reflexively.
    await render(<UseMyLocationRow position={null} />)
    await beat()
    expect(sheet()).toBeNull()
    // The row is still there to be tapped.
    expect(rowLabel()).toBe('Use my location')
  })

  it('spends the ask on OPENING, not on the rider answering', async () => {
    // The mutation this refuses: marking the flag when the rider taps
    // `Continue`. A rider who dismisses would then be asked again on every
    // cold start, for ever — which is exactly how riders learn to decline
    // permanently, and the whole reason the flag exists.
    await render(<UseMyLocationRow position={null} auto />)
    await beat()
    expect(sheet()).not.toBeNull()

    // A second mount, as a later session would be: same device, same flag.
    act(() => root.unmount())
    root = createRoot(container)
    await render(<UseMyLocationRow position={null} auto />)
    await beat()

    expect(sheet()).toBeNull()
  })

  it('does NOT spend the ask when the rider leaves inside the beat', async () => {
    // The correctness half of the delay, and the reason `markAskedForLocation`
    // is called inside the timer rather than beside it. These screens remount
    // routinely — a filter tap, a bottom-bar tap, a back gesture — and claiming
    // the flag in the effect body would spend the device's one automatic ask on
    // a rider who never saw a sheet, who would then never be asked again.
    await render(<UseMyLocationRow position={null} auto />)
    act(() => root.unmount())

    // Nothing was drawn, so nothing was spent: a fresh mount still asks.
    root = createRoot(container)
    await render(<UseMyLocationRow position={null} auto />)
    await beat()

    expect(sheet()).not.toBeNull()
  })

  it('does not ask while the permission is still unread', async () => {
    // `hidden` is `locationPrimingState`'s answer to an undecided input, and
    // the ask must not fire through it — otherwise the flag is spent before
    // anyone knows whether there was anything to ask.
    let settle: (value: string) => void = () => {}
    deviceLocationPermission.mockImplementation(
      () => new Promise((resolve) => (settle = resolve))
    )

    await render(<UseMyLocationRow position={null} auto />)
    await beat()
    expect(sheet()).toBeNull()

    await act(async () => settle('prompt'))
    await beat()
    expect(sheet()).not.toBeNull()
  })

  it('does not interrupt a rider who already has a position', async () => {
    // `refine` draws a row and never opens anything by itself: the distances on
    // screen are already working, so there is nothing urgent to say.
    await render(<UseMyLocationRow position={PROFILE} town="Utrecht" auto />)
    await beat()
    expect(sheet()).toBeNull()
  })
})

describe('the refine row says where the distances are measured from', () => {
  it('names the town when the screen supplies one', async () => {
    await render(<UseMyLocationRow position={PROFILE} town="Utrecht" />)
    expect(rowLabel()).toBe('Near Utrecht · Use my location')
  })

  it('falls back to the bare offer when the screen has no town to give', async () => {
    // A screen that does not read `profiles.location` for its own purposes must
    // not take a round trip to render one word — see the prop's own comment.
    await render(<UseMyLocationRow position={PROFILE} />)
    expect(rowLabel()).toBe('Use my location')
  })

  it('draws nothing beside a device position', async () => {
    // The best answer this app has; there is no upgrade to offer.
    await render(
      <UseMyLocationRow position={{ lat: 52.09, lon: 5.12, source: 'device' }} town="Utrecht" />
    )
    expect(container.querySelector('button')).toBeNull()
  })
})

describe('the town rung', () => {
  it('goes straight to the town question where there is no device to ask', async () => {
    deviceLocationPermission.mockResolvedValue('unavailable')

    await render(<UseMyLocationRow position={null} auto />)
    await beat()

    // No priming sheet — there is no dialog to prime — and the town question
    // instead, which is the whole offer in this state.
    expect(document.querySelector('[data-testid="town-sheet"]')).not.toBeNull()
  })

  it('the automatic timer does not open a second sheet over one the rider opened', async () => {
    // **Found by the pre-merge review.** The timer is armed when the row first
    // renders and its deps are `[auto, state]`, neither of which changes when a
    // sheet opens — so a rider who taps inside the 700ms beat would get the
    // automatic open landing on top of their own. Two `ContextMenu`s stack two
    // scrims, and each restores `document.body.style.overflow` to what it
    // captured on mount: close them in the wrong order and the screen is left
    // unscrollable until a reload, with nothing on it to explain why.
    deviceLocationPermission.mockResolvedValue('denied')
    await render(<UseMyLocationRow position={null} auto />)

    // Inside the beat: the rider taps the row, then its `Set your town`.
    const row = container.querySelector('button')!
    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const askTown = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Set your town'
    )!
    await act(async () => {
      askTown.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.querySelector('[data-testid="town-sheet"]')).not.toBeNull()

    // Now the timer fires. It must not reopen the priming sheet behind the town
    // sheet the rider is looking at.
    await beat()

    expect(sheet()).toBeNull()
    expect(document.querySelector('[data-testid="town-sheet"]')).not.toBeNull()
  })

  it('does not REOPEN a sheet the rider opened and dismissed inside the beat', async () => {
    // **Found by the delta re-review**, and it is the half a guard that mirrors
    // `open || askingTown` misses: by the time the timer fires the rider has
    // already closed the sheet, so the mirror reads `false` and the automatic
    // open fires anyway. An app that reopens a permission prompt 100ms after it
    // is dismissed is the reflexive-dismissal shape this component's own header
    // is written against.
    await render(<UseMyLocationRow position={null} auto />)

    const row = container.querySelector('button')!
    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(sheet()).not.toBeNull()

    // Dismissed by the rider, still inside the beat.
    const notNow = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Not now'
    )!
    await act(async () => {
      notNow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(sheet()).toBeNull()

    await beat()

    // Still closed. The rider engaged; the automatic ask has nothing left to do.
    expect(sheet()).toBeNull()
  })

  it('never leaves both sheets open at once', async () => {
    // Both are `ContextMenu`s, and each locks body scroll on mount and restores
    // it on unmount. Two open together would leave the lower one's cleanup to
    // restore `overflow` after the upper one already had, so the page would
    // stay unscrollable after both closed.
    deviceLocationPermission.mockResolvedValue('denied')
    await render(<UseMyLocationRow position={null} auto />)
    await beat()

    const askTown = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Set your town'
    )
    expect(askTown).toBeDefined()

    await act(async () => {
      askTown!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.querySelector('[data-testid="town-sheet"]')).not.toBeNull()
    expect(sheet()).toBeNull()
  })
})
