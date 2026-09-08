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
// it, and stubbing it keeps this file about the row's own decisions. `onClose`
// carries the failed-save flag, so the stub renders the two buttons that let a
// test close it either way.
vi.mock('@/components/location/TownQuestionSheet', () => ({
  TownQuestionSheet: ({
    open,
    onClose,
  }: {
    open: boolean
    onClose: (info: { saveFailed: boolean }) => void
  }) =>
    open ? (
      <div data-testid="town-sheet">
        <button type="button" onClick={() => onClose({ saveFailed: false })}>
          walk away
        </button>
        <button type="button" onClick={() => onClose({ saveFailed: true })}>
          save failed
        </button>
      </div>
    ) : null,
}))

const { LocationQuestionRow } = await import('@/components/location/LocationQuestionRow')
const { readDismissal, resetDismissalForTests } = await import('@/lib/location/dismissal')

/**
 * The row's own decisions — PD-447, replacing `UseMyLocationRow.dom.test.tsx`.
 *
 * **`locationPrimingState` and `locationQuestionLabel` are tested separately
 * and exhaustively**; what cannot be reached from there is what this file owns:
 * that nothing opens by itself, which sheet each state routes a TAP to, and
 * what a close does to the dismissal ladder.
 *
 * **jsdom rather than `renderToStaticMarkup`, and the reasons changed with
 * PD-447.** It is now an **event** and a **portal**: every assertion below
 * turns on a click, and both sheets are `ContextMenu`s that portal to
 * `document.body`. It is no longer *a timer inside a mounted effect* — that
 * timer is deleted. The permission read is still a promise resolved in a
 * mounted effect, so under `environment: 'node'` this component renders `null`
 * for ever and every assertion would pass against one that does nothing.
 *
 * Verified both ways: restoring an automatic open fails *nothing opens by
 * itself*; routing `confirm` through the priming sheet fails *confirm goes
 * straight to the town sheet*; recording a dismissal on a failed save fails
 * *a save that did not land is not a dismissal*.
 */

const PROFILE = { lat: 52.09, lon: 5.12, source: 'profile' as const }
const DEVICE = { lat: 52.09, lon: 5.12, source: 'device' as const }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  deviceLocationPermission.mockReset()
  requestDeviceLocation.mockReset()
  deviceLocationPermission.mockResolvedValue('prompt')
  resetDismissalForTests()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root.unmount())
  container.remove()
  resetDismissalForTests()
})

/** Mounts and lets the permission and dismissal effects settle. */
async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

/** Runs out any timer a regression might have introduced. There is none to wait
 *  for by design — which is exactly what the first test asserts. */
async function beat() {
  await act(async () => {
    vi.advanceTimersByTime(5_000)
  })
}

const sheet = () => document.querySelector('[role="dialog"]')
const townSheet = () => document.querySelector('[data-testid="town-sheet"]')
const row = () => container.querySelector('button')
const rowLabel = () => container.querySelector('button span')?.textContent

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function buttonNamed(text: string) {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
}

describe('nothing opens by itself', () => {
  it.each([
    ['ask', null],
    ['blocked', null],
    ['town', null],
  ] as const)('draws the row and no sheet in %s, however long the screen sits', async (_state, position) => {
    // **The reversal of PD-419, pinned.** That change opened the priming sheet
    // on a 700ms timer, once per install, at Explore. A sheet that opens itself
    // is how riders learn to dismiss permission prompts reflexively — and on
    // iOS the dialog behind it is one-way, so a reflexive dismissal is
    // permanent. A later change restoring an automatic open is making a new
    // decision against this, not repairing an oversight.
    deviceLocationPermission.mockResolvedValue(
      _state === 'ask' ? 'prompt' : _state === 'blocked' ? 'denied' : 'unavailable'
    )
    await render(<LocationQuestionRow position={position} town={null} />)
    await beat()

    expect(sheet()).toBeNull()
    expect(townSheet()).toBeNull()
    // Still there to be tapped.
    expect(rowLabel()).toBe('Where do you ride from?')
  })

  it('draws nothing at all once the permission is granted', async () => {
    deviceLocationPermission.mockResolvedValue('granted')
    await render(<LocationQuestionRow position={DEVICE} town="Hoorn" />)
    await beat()
    expect(row()).toBeNull()
  })
})

describe('a tap routes by state, never by re-reading the permission', () => {
  it('opens the priming sheet from refine, where a device can still be asked', async () => {
    await render(<LocationQuestionRow position={PROFILE} town="Hoorn" />)
    expect(rowLabel()).toBe('Still in Hoorn?')

    await click(row()!)
    expect(sheet()).not.toBeNull()
    expect(townSheet()).toBeNull()
  })

  it('goes straight to the town sheet from confirm', async () => {
    // **The lifted exclusion, and the whole reason `confirm` is a state rather
    // than a branch here.** iOS will not re-raise the dialog for the life of
    // the install, so offering it to this rider is a dead end — the town is the
    // route that works.
    deviceLocationPermission.mockResolvedValue('denied')
    await render(<LocationQuestionRow position={PROFILE} town="Hoorn" />)
    expect(rowLabel()).toBe('Still in Hoorn?')

    await click(row()!)
    expect(townSheet()).not.toBeNull()
    expect(sheet()).toBeNull()
  })

  it('goes straight to the town sheet where the platform has no geolocation', async () => {
    deviceLocationPermission.mockResolvedValue('unavailable')
    await render(<LocationQuestionRow position={null} town={null} />)

    await click(row()!)
    expect(townSheet()).not.toBeNull()
    expect(sheet()).toBeNull()
  })

  it('never leaves both sheets open at once', async () => {
    // Both are `ContextMenu`s, and each locks body scroll on mount and restores
    // it on unmount. Two open together would leave the lower one's cleanup to
    // restore `overflow` after the upper one already had, so the page would
    // stay unscrollable after both closed.
    deviceLocationPermission.mockResolvedValue('denied')
    await render(<LocationQuestionRow position={null} town={null} />)

    await click(row()!)
    expect(sheet()).not.toBeNull()

    await click(buttonNamed('Set your town'))

    expect(townSheet()).not.toBeNull()
    expect(sheet()).toBeNull()
  })
})

describe('closing without an answer is a dismissal', () => {
  it('takes the row away in the same render and records a rung', async () => {
    // The defect: the record is written but the row is still sitting there
    // afterwards, so the dismissal reads as not having taken and the rider taps
    // it again. Nothing re-reads the store until the next mount.
    await render(<LocationQuestionRow position={null} town={null} />)
    await click(row()!)

    await click(buttonNamed('Not now'))

    expect(row()).toBeNull()
    expect(sheet()).toBeNull()
    expect(readDismissal()?.n).toBe(1)
  })

  it('counts a walk-away from the town sheet too', async () => {
    deviceLocationPermission.mockResolvedValue('unavailable')
    await render(<LocationQuestionRow position={null} town={null} />)
    await click(row()!)

    await click(buttonNamed('walk away'))

    expect(row()).toBeNull()
    expect(readDismissal()?.n).toBe(1)
  })

  it('a save that did not land is NOT a dismissal', async () => {
    // Offline is the ordinary cause. That rider answered the question and was
    // refused — silencing them for a month would punish the network, and it is
    // the one rider who has just shown they want to answer.
    deviceLocationPermission.mockResolvedValue('unavailable')
    await render(<LocationQuestionRow position={null} town={null} />)
    await click(row()!)

    await click(buttonNamed('save failed'))

    expect(townSheet()).toBeNull()
    // The row is still there, and nothing was written.
    expect(row()).not.toBeNull()
    expect(readDismissal()).toBeNull()
  })

  it('moving on to the town question is not a dismissal either', async () => {
    // `Set your town` is the rider heading TOWARDS an answer. Recording a rung
    // there would charge them for the hand-off between two sheets.
    deviceLocationPermission.mockResolvedValue('denied')
    await render(<LocationQuestionRow position={null} town={null} />)
    await click(row()!)

    await click(buttonNamed('Set your town'))

    expect(readDismissal()).toBeNull()
  })
})

describe('the device answer', () => {
  it('clears the record and the row when a fix comes back', async () => {
    requestDeviceLocation.mockResolvedValue(DEVICE)
    deviceLocationPermission.mockResolvedValueOnce('prompt').mockResolvedValue('granted')

    await render(<LocationQuestionRow position={null} town={null} />)
    await click(row()!)
    await click(buttonNamed('Continue'))

    expect(readDismissal()).toBeNull()
    expect(row()).toBeNull()
  })

  it('keeps a refine rider reading after they deny, as confirm', async () => {
    // **Changed by PD-447.** That rider used to become `hidden` on the denial,
    // so the row unmounted and took the open sheet with it — the explanation of
    // what was just lost was never read. The lifted exclusion turns them into
    // `confirm`, so the row stays and the sheet re-renders as the denied copy.
    requestDeviceLocation.mockResolvedValue(null)
    deviceLocationPermission.mockResolvedValueOnce('prompt').mockResolvedValue('denied')

    await render(<LocationQuestionRow position={PROFILE} town="Hoorn" />)
    await click(row()!)
    await click(buttonNamed('Continue'))

    expect(sheet()).not.toBeNull()
    expect(buttonNamed('Set your town')).toBeDefined()
    expect(rowLabel()).toBe('Still in Hoorn?')
  })
})
