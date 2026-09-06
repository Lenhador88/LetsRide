// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RIDE_AUDIENCE_REFUSAL } from '@/lib/rides/audience'
import type { RideForEdit } from '@/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

const { EditRideForm } = await import('@/components/rides/EditRideForm')

/**
 * The refused half of PD-338's rule, driven through real events.
 *
 * **jsdom rather than `renderToStaticMarkup`, and the reason is structural
 * rather than a preference.** `EditRideForm` seeds its controlled state from
 * the ride, so on mount the submitted pair always equals the stored pair and
 * `narrowsToNobody` is false for every ride there is. The disabled Save and the
 * alert are reachable only by the rider *changing* a control, which a static
 * render cannot do — so a suite without this file would pin "an already-private
 * clubless ride is editable" and leave "the transition is still refused"
 * resting on nothing. A build that hardcoded `disabled={false}` would pass
 * every other assertion in this directory.
 *
 * `audience.test.ts` owns the predicate's own truth table. What this file owns
 * is the **wiring**: that the form actually reads it, in both directions, and
 * renders the shared refusal string when it fires.
 *
 * **Verified both ways** (`CLAUDE.md` §Working Principles): pinning
 * `wouldNarrow` to `false` in the component fails both refusal cases below and
 * leaves every other test in the repo green, which is what proves these
 * assertions are pinned to the guard rather than to the form's plumbing.
 */

const CLUB = '11111111-2222-4333-8444-555555555555'

const ride = (over: Partial<RideForEdit> = {}): RideForEdit => ({
  id: '77777777-6666-4555-8444-333333333333',
  title: 'Sunday run',
  route_description: null,
  meeting_point: 'Dam Square, Amsterdam',
  departure_at: '2027-05-01T09:00:00+00:00',
  timezone: 'Europe/Amsterdam',
  is_public: false,
  club_id: null,
  start_place_id: null,
  latitude: null,
  longitude: null,
  club: null,
  organizer_id: '22222222-3333-4444-8555-666666666666',
  is_organizer: true,
  ...over,
})

const clubs = [{ id: CLUB, name: 'Dyke Runners' }]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const mount = (props: Parameters<typeof EditRideForm>[0]) => {
  act(() => root.render(<EditRideForm {...props} />))
}

const save = () =>
  container.querySelector<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement

const publicBox = () =>
  container.querySelector<HTMLInputElement>('input[name="is_public"]') as HTMLInputElement

const clubSelect = () =>
  container.querySelector<HTMLSelectElement>('select[name="club_id"]') as HTMLSelectElement

/** React tracks the DOM value, so a change event has to go through its setter. */
const setChecked = (input: HTMLInputElement, checked: boolean) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'checked'
    )!.set!
    setter.call(input, checked)
    input.dispatchEvent(new Event('click', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const setSelect = (select: HTMLSelectElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )!.set!
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const alertText = () =>
  container.querySelector('[role="alert"]')?.textContent?.trim() ?? null

describe('un-publishing a ride that is in no club', () => {
  it('disables Save and shows the refusal', () => {
    mount({ ride: ride({ club_id: null, is_public: true }), clubs })
    expect(save().disabled).toBe(false)

    setChecked(publicBox(), false)

    expect(save().disabled).toBe(true)
    expect(alertText()).toBe(RIDE_AUDIENCE_REFUSAL)
  })

  it('lets the rider back out — re-ticking clears the refusal', () => {
    mount({ ride: ride({ club_id: null, is_public: true }), clubs })
    setChecked(publicBox(), false)
    setChecked(publicBox(), true)

    expect(save().disabled).toBe(false)
    expect(alertText()).toBeNull()
  })

  it('is cleared by picking a club instead — the other remedy the message names', () => {
    mount({ ride: ride({ club_id: null, is_public: true }), clubs })
    setChecked(publicBox(), false)
    expect(save().disabled).toBe(true)

    setSelect(clubSelect(), CLUB)

    expect(save().disabled).toBe(false)
    expect(alertText()).toBeNull()
  })
})

describe('detaching a private ride from its club', () => {
  it('disables Save and shows the refusal', () => {
    mount({
      ride: ride({ club_id: CLUB, is_public: false, club: { id: CLUB, name: 'Dyke Runners' } }),
      clubs,
    })
    expect(save().disabled).toBe(false)

    setSelect(clubSelect(), '')

    expect(save().disabled).toBe(true)
    expect(alertText()).toBe(RIDE_AUDIENCE_REFUSAL)
  })

  it('permits detaching together with making it public — the anti-detach rule’s own exit', () => {
    mount({
      ride: ride({ club_id: CLUB, is_public: false, club: { id: CLUB, name: 'Dyke Runners' } }),
      clubs,
    })
    setSelect(clubSelect(), '')
    setChecked(publicBox(), true)

    expect(save().disabled).toBe(false)
    expect(alertText()).toBeNull()
  })
})

describe('a ride that ARRIVED clubless and private', () => {
  it('stays editable while the rider leaves the public box alone', () => {
    // PD-338's headline, through the real controls rather than through markup:
    // this is the ride PD-320's composer default produces, and before this
    // change Save was disabled the moment the screen opened.
    mount({ ride: ride({ club_id: null, is_public: false }), clubs })

    expect(save().disabled).toBe(false)
    expect(alertText()).toBeNull()

    // Editing another field changes nothing about the audience.
    const title = container.querySelector<HTMLInputElement>('input[name="title"]')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(title, 'Sunday run, moved an hour later')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(save().disabled).toBe(false)
    expect(alertText()).toBeNull()
  })

  it('cannot be pushed into the refusal by any control on the form', () => {
    // There is no transition available from "no standing audience" — every
    // change is a widening. This is what makes the screen a dead end no longer.
    mount({ ride: ride({ club_id: null, is_public: false }), clubs })

    setChecked(publicBox(), true)
    expect(save().disabled).toBe(false)
    setChecked(publicBox(), false)
    expect(save().disabled).toBe(false)
    setSelect(clubSelect(), CLUB)
    expect(save().disabled).toBe(false)
    setSelect(clubSelect(), '')
    expect(save().disabled).toBe(false)
    expect(alertText()).toBeNull()
  })
})
