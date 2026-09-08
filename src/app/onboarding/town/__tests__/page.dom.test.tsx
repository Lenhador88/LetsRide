/**
 * @vitest-environment jsdom
 *
 * The town step's two FALLBACK branches — PD-445.
 *
 * **jsdom because both branches are reached only by an event.** One needs a
 * pick handed to the page through `PlaceSearchField`'s `onChange`; the other
 * needs a lookup failure handed to it through `onLookupFailure`, which the
 * field raises from an effect. Neither exists in a static render, and
 * `page.test.tsx` next door says so rather than leaving the gap unexplained.
 *
 * The place field is stubbed. What is under test is the STEP's decision — when
 * the country select appears, when the submit unlocks, and how many fields
 * called `country` are live — not the field's own search behaviour, which
 * `place-search-field.test.tsx` owns and which would drag a metered vendor
 * lookup into this file.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceValue } from '@/components/ui/PlaceSearchField'

vi.mock('@/lib/actions/navigate', () => ({ useActionRedirect: () => {} }))

// The stub exposes the two callbacks the step passes down, so a test can act as
// the field without running a search.
let handers: {
  onChange?: (value: PlaceValue | null) => void
  onLookupFailure?: (error: Error) => void
} = {}

vi.mock('@/components/ui/PlaceSearchField', () => ({
  PlaceSearchField: (props: {
    onChange: (value: PlaceValue | null) => void
    onLookupFailure?: (error: Error) => void
  }) => {
    handers = { onChange: props.onChange, onLookupFailure: props.onLookupFailure }
    return <input data-testid="place-field" />
  },
}))

import OnboardingTownPage from '@/app/onboarding/town/page'

const withCountry: PlaceValue = {
  name: 'Hoorn',
  placeId: 'geoapify:abc',
  lat: 52.642,
  lon: 5.06,
  countryCode: 'NL',
}

// `countryCode` OMITTED, not null. `PlaceValue` marks it optional, and seeded
// values from before the column carry no property at all — so the step's test
// must be for absence, which `!place.countryCode` does and
// `place.countryCode === null` does not.
const withoutCountry: PlaceValue = {
  name: 'Someplace',
  placeId: 'geoapify:xyz',
  lat: 1,
  lon: 1,
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  handers = {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<OnboardingTownPage />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const submit = () => container.querySelector('button[type="submit"]') as HTMLButtonElement
const countryFields = () => container.querySelectorAll('[name="country"]')
const townField = () => container.querySelector('input[name="town"]') as HTMLInputElement | null

describe('a pick that carried a country', () => {
  it('submits the town and the country, with no country select', () => {
    act(() => handers.onChange!(withCountry))
    expect(submit().disabled).toBe(false)
    expect(townField()?.value).toBe('Hoorn')
    // Exactly one — the step's own hidden input. The select must not also be
    // on screen, or `formData.get('country')` reads whichever comes first.
    expect(countryFields()).toHaveLength(1)
    expect(container.textContent).not.toContain('Country')
  })
})

describe('a pick that carried NO country', () => {
  it('reveals the country select and holds the submit until it is answered', () => {
    act(() => handers.onChange!(withoutCountry))
    // `114` refuses to stamp completion while `home_country` is NULL, so
    // without this branch a town with no country strands the rider on the last
    // step with no way forward.
    expect(container.textContent).toContain('Country')
    expect(submit().disabled).toBe(true)
    expect(townField()?.value).toBe('Someplace')
  })

  it('still carries exactly one field named country', () => {
    act(() => handers.onChange!(withoutCountry))
    // The step's own hidden input is suppressed on this branch precisely so the
    // select's is the only one. Two would silently shadow the rider's answer.
    expect(countryFields()).toHaveLength(1)
  })
})

describe('the lookup is unavailable — the escape', () => {
  it('reveals the country select with no pick at all', () => {
    // Onboarding must not be completable ONLY through a third party.
    // `search-places` carries an application-wide ceiling, so without this
    // branch an outage means no new rider anywhere can finish onboarding.
    act(() => handers.onLookupFailure!(new Error('unavailable')))
    expect(container.textContent).toContain('Country')
    expect(townField()).toBeNull()
  })

  it('is NOT opened by the rider simply not picking anything', () => {
    // The escape must never become the Skip decision #5 forbids. Nothing has
    // failed here — the rider has just not answered — so there must be no
    // second control to reach for.
    expect(container.textContent).not.toContain('Country')
    expect(submit().disabled).toBe(true)
  })

  it('stays open after a later lookup succeeds', () => {
    // Taking the escape away because a retry happened to answer would move the
    // control the rider is reaching for, mid-tap.
    act(() => handers.onLookupFailure!(new Error('unavailable')))
    act(() => handers.onChange!(withCountry))
    expect(container.textContent).toContain('Country')
  })
})
