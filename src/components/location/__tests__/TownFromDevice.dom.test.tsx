// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
/**
 * The town question's *Use my current location* — PD-477.
 *
 * **jsdom because every case is an event or an effect**: the permission is read
 * in a mounted effect, the request runs from a click, and the late-answer rule
 * is decided by an input event on the wrapped field. None of it exists in a
 * static render.
 *
 * The device and the vendor are stubbed. What is under test is the control's
 * decision for each outcome in the proposal's table — not the geolocation
 * plumbing, which `rider-location.test.ts` owns, nor the reverse geocode,
 * which `places.test.ts` owns.
 *
 * Verified both ways: each case below was seen to fail with its guard removed
 * (the denial branch, the ceiling, the touched counter, the unmount check, the
 * permission gate on render).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceSearchResult } from '@/types'

const deviceLocationPermission = vi.fn()
const requestDeviceLocation = vi.fn()
vi.mock('@/lib/location/rider-location', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/location/rider-location')>()),
  deviceLocationPermission: () => deviceLocationPermission(),
  requestDeviceLocation: () => requestDeviceLocation(),
}))

const reverseGeocodePlace = vi.fn()
vi.mock('@/lib/data/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/places')>()),
  reverseGeocodePlace: (lat: number, lon: number) => reverseGeocodePlace(lat, lon),
}))

const clearDismissal = vi.fn()
vi.mock('@/lib/location/dismissal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/location/dismissal')>()),
  clearDismissal: () => clearDismissal(),
}))

const invalidate = vi.fn()
vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query')>()),
  invalidate: (key: unknown) => invalidate(key),
}))

const { TownFromDevice, TOWN_FROM_DEVICE_CEILING_MS, TOWN_FROM_DEVICE_MISSED } = await import(
  '@/components/location/TownFromDevice'
)

const FIX = { lat: 52.6424, lon: 5.0602, source: 'device' as const }
const HOORN = {
  id: 'geoapify:hoorn',
  label: 'Hoorn',
  meta: 'Noord-Holland, Netherlands',
  lat: 52.6424,
  lon: 5.0602,
  countryCode: 'NL',
  timezone: 'Europe/Amsterdam',
} as unknown as PlaceSearchResult

let container: HTMLDivElement
let root: Root
const onFound = vi.fn()

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  for (const fn of [
    deviceLocationPermission,
    requestDeviceLocation,
    reverseGeocodePlace,
    invalidate,
    clearDismissal,
    onFound,
  ]) {
    fn.mockReset()
  }
  deviceLocationPermission.mockResolvedValue('prompt')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root.unmount())
  container.remove()
})

async function render() {
  await act(async () => {
    root.render(
      <TownFromDevice onFound={onFound}>
        <input data-testid="town-field" />
      </TownFromDevice>
    )
  })
}

const control = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Use my current location'))
const status = () => container.querySelector('[role="status"]')?.textContent ?? ''

async function tap() {
  await act(async () => {
    control()!.click()
  })
}

describe('whether the control draws at all', () => {
  it.each(['unavailable', 'denied'])('draws nothing when the permission reads %s', async (state) => {
    deviceLocationPermission.mockResolvedValue(state)
    await render()
    expect(control()).toBeUndefined()
    // The field itself is untouched — typing a town stays sufficient.
    expect(container.querySelector('[data-testid="town-field"]')).not.toBeNull()
  })

  it.each(['prompt', 'granted'])('draws when the permission reads %s, and asks nothing on mount', async (state) => {
    deviceLocationPermission.mockResolvedValue(state)
    await render()
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(control()).toBeDefined()
    // Never unasked: a mount, however long it sits, raises no OS dialog.
    expect(requestDeviceLocation).not.toHaveBeenCalled()
  })
})

describe('a tap', () => {
  it('granted and named: hands the town over as a pick with its country, and writes nothing', async () => {
    requestDeviceLocation.mockResolvedValue(FIX)
    reverseGeocodePlace.mockResolvedValue(HOORN)
    await render()
    await tap()

    expect(reverseGeocodePlace).toHaveBeenCalledWith(FIX.lat, FIX.lon)
    expect(onFound).toHaveBeenCalledTimes(1)
    expect(onFound.mock.calls[0][0]).toMatchObject({ placeId: 'geoapify:hoorn', countryCode: 'NL' })
    // NOT invalidated on the tap: on Explore the sheet belongs to the question
    // row, and a refresh answering from this fix hides the row — and the sheet
    // with it — before the town lands. The save refreshes instead.
    expect(invalidate).not.toHaveBeenCalled()
    // A grant clears the Explore row's dismissal record outright, as the row's
    // own grant does.
    expect(clearDismissal).toHaveBeenCalledTimes(1)
    expect(status()).toBe('')
  })

  it('never submits the form it sits in', async () => {
    const submitted = vi.fn((event: Event) => event.preventDefault())
    await act(async () => {
      root.render(
        <form onSubmit={(event) => submitted(event.nativeEvent)}>
          <TownFromDevice onFound={onFound}>
            <input data-testid="town-field" />
          </TownFromDevice>
        </form>
      )
    })
    requestDeviceLocation.mockReturnValue(new Promise(() => {}))
    expect(control()!.getAttribute('type')).toBe('button')
    await tap()
    expect(submitted).not.toHaveBeenCalled()
  })

  it.each(['denied', 'prompt'])('no fix and the permission reads %s afterwards: the control goes, silently', async (after) => {
    // `prompt` is the WebView whose Permissions API does not know geolocation:
    // a denial there reads the same, and nothing may invite a retry.
    requestDeviceLocation.mockResolvedValue(null)
    await render()
    deviceLocationPermission.mockResolvedValue(after)
    await tap()

    expect(control()).toBeUndefined()
    expect(container.textContent).not.toContain(TOWN_FROM_DEVICE_MISSED)
    expect(onFound).not.toHaveBeenCalled()
    expect(reverseGeocodePlace).not.toHaveBeenCalled()
  })

  it('granted but no fix: back to idle with one non-error line, and the control stays', async () => {
    requestDeviceLocation.mockResolvedValue(null)
    deviceLocationPermission.mockResolvedValue('granted')
    await render()
    await tap()

    expect(status()).toBe(TOWN_FROM_DEVICE_MISSED)
    expect(container.querySelector('[role="status"]')!.className).not.toContain('danger')
    expect(control()).toBeDefined()
    expect(control()!.disabled).toBe(false)
    expect(onFound).not.toHaveBeenCalled()
  })

  it('a fix the vendor cannot name (or a spent ceiling) is not a town', async () => {
    requestDeviceLocation.mockResolvedValue(FIX)
    reverseGeocodePlace.mockResolvedValue(null)
    await render()
    await tap()

    expect(status()).toBe(TOWN_FROM_DEVICE_MISSED)
    expect(onFound).not.toHaveBeenCalled()
  })

  it('a fix that never arrives resolves at the ceiling rather than spinning', async () => {
    requestDeviceLocation.mockReturnValue(new Promise(() => {}))
    await render()
    await tap()
    expect(control()!.disabled).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(TOWN_FROM_DEVICE_CEILING_MS)
    })
    expect(control()!.disabled).toBe(false)
    expect(status()).toBe(TOWN_FROM_DEVICE_MISSED)
  })

  it("the ceiling releases the control but keeps a slow reader's answer", async () => {
    let answer: (value: typeof FIX) => void = () => {}
    requestDeviceLocation.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    reverseGeocodePlace.mockResolvedValue(HOORN)
    await render()
    await tap()
    await act(async () => {
      vi.advanceTimersByTime(TOWN_FROM_DEVICE_CEILING_MS)
    })
    expect(status()).toBe(TOWN_FROM_DEVICE_MISSED)

    // The rider finally taps Allow on the modal dialog.
    await act(async () => {
      answer(FIX)
    })
    expect(onFound).toHaveBeenCalledTimes(1)
    expect(status()).toBe('')
  })

  it('a new tap clears the previous miss', async () => {
    requestDeviceLocation.mockResolvedValue(null)
    deviceLocationPermission.mockResolvedValue('granted')
    await render()
    await tap()
    expect(status()).toBe(TOWN_FROM_DEVICE_MISSED)

    requestDeviceLocation.mockReturnValue(new Promise(() => {}))
    await tap()
    expect(status()).toBe('')
  })
})

describe('the answer lands only where the rider has not answered first', () => {
  it('drops a late town once the rider has touched the field since the tap', async () => {
    let answer: (value: typeof FIX) => void = () => {}
    requestDeviceLocation.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    reverseGeocodePlace.mockResolvedValue(HOORN)
    await render()
    await tap()

    const field = container.querySelector('[data-testid="town-field"]') as HTMLInputElement
    await act(async () => {
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      answer(FIX)
    })

    expect(onFound).not.toHaveBeenCalled()
  })

  it('does not call back into a sheet that has already closed', async () => {
    let answer: (value: typeof FIX) => void = () => {}
    requestDeviceLocation.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    reverseGeocodePlace.mockResolvedValue(HOORN)
    await render()
    await tap()

    await act(async () => {
      root.render(<div />)
    })
    await act(async () => {
      answer(FIX)
    })

    expect(onFound).not.toHaveBeenCalled()
  })
})
