// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CountrySelect,
  filterCountryOptions,
  normalizeCountryQuery,
  resolveCountryKey,
  wrapCountryIndex,
} from '@/components/ui/CountrySelect'

/**
 * `jsdom`, not `renderToStaticMarkup` — matching `EditRideForm.dom.test.tsx`'s
 * own reasoning for the same choice. This control's whole point is a mounted
 * effect (opening the list on focus and landing the highlight on the current
 * pick), real keyboard events (`resolveCountryKey`'s decisions have to
 * actually fire `preventDefault` or not, which only a real, cancelable
 * `dispatchEvent` can show — a static render has no event to dispatch) and a
 * blur that reverts an in-progress draft. None of those exist in markup.
 *
 * `resolveCountryKey`/`wrapCountryIndex`/`filterCountryOptions`/
 * `normalizeCountryQuery` are pure and are asserted directly below too —
 * `PlaceSearchField`'s split of `resolveComboboxKey` out for its own
 * `node`-environment test is the same idea; they are just co-located here
 * rather than in a second file, since this file already pays jsdom's cost for
 * the mounted half.
 */

// jsdom does not implement `scrollIntoView` at all — same stub
// `ClubTimeline.test.tsx` uses for the same reason, since the active-option
// effect below calls it on every highlight change once the list is mounted.
Element.prototype.scrollIntoView = vi.fn()

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

const mount = (props: Parameters<typeof CountrySelect>[0]) => {
  act(() => root.render(<CountrySelect {...props} />))
}

const getInput = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!

/** React tracks the DOM value itself, so a change has to go through its own setter. */
function typeInto(input: HTMLInputElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Returns what `dispatchEvent` returns: `false` iff the handler called
 *  `preventDefault()` — the direct way to assert `resolveCountryKey`'s
 *  "must not swallow the key" half without inspecting React internals. */
function dispatchKey(el: HTMLElement, key: string): boolean {
  let notPrevented = true
  act(() => {
    notPrevented = el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  return notPrevented
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('CountrySelect — idle display', () => {
  it('shows the flag and name of the picked country when idle', () => {
    mount({ label: 'Home country', value: 'NL', onChange: vi.fn() })
    expect(getInput().value).toContain('Netherlands')
  })

  it('is empty when nothing is picked', () => {
    mount({ label: 'Home country', value: null, onChange: vi.fn() })
    expect(getInput().value).toBe('')
  })
})

describe('CountrySelect — opening', () => {
  it('opens the list on focus and highlights the current pick', () => {
    mount({ label: 'Home country', value: 'NL', onChange: vi.fn() })
    const input = getInput()
    act(() => input.focus())

    expect(container.querySelector('[role="listbox"]')).not.toBeNull()
    const activeId = input.getAttribute('aria-activedescendant')
    expect(activeId).toBeTruthy()
    expect(document.getElementById(activeId!)?.textContent).toContain('Netherlands')
  })

  it('highlights nothing when no country is picked yet', () => {
    mount({ label: 'Home country', value: null, onChange: vi.fn() })
    act(() => getInput().focus())
    expect(getInput().getAttribute('aria-activedescendant')).toBeNull()
  })
})

describe('CountrySelect — typing filters, and Enter selects the highlighted match', () => {
  it('narrows the list to a name match and selects it on Enter', () => {
    const onChange = vi.fn()
    mount({ label: 'Home country', value: null, onChange })
    const input = getInput()
    act(() => input.focus())

    typeInto(input, 'andorra')
    const options = container.querySelectorAll('[role="option"]')
    expect(options.length).toBe(1)
    expect(options[0].textContent).toContain('Andorra')

    const moved = dispatchKey(input, 'ArrowDown')
    expect(moved).toBe(false) // handled — preventDefault called
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)

    const selected = dispatchKey(input, 'Enter')
    expect(selected).toBe(false) // handled — must not also submit a form
    expect(onChange).toHaveBeenCalledWith('AD')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('matches by ISO code as well as name', () => {
    const onChange = vi.fn()
    mount({ label: 'Home country', value: null, onChange })
    const input = getInput()
    act(() => input.focus())

    typeInto(input, 'nl')
    const options = [...container.querySelectorAll('[role="option"]')]
    expect(options.some((option) => option.textContent?.includes('Netherlands'))).toBe(true)
  })

  it('shows "No countries match" for a query nothing matches, and Enter does nothing', () => {
    const onChange = vi.fn()
    mount({ label: 'Home country', value: null, onChange })
    const input = getInput()
    act(() => input.focus())

    typeInto(input, 'zzzzzzzzzz')
    expect(container.querySelectorAll('[role="option"]').length).toBe(0)
    expect(container.textContent).toContain('No countries match that search.')

    dispatchKey(input, 'Enter')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('CountrySelect — Enter with nothing highlighted must not swallow the key', () => {
  it('does not call preventDefault, so a surrounding form can still submit', () => {
    const onChange = vi.fn()
    mount({ label: 'Home country', value: null, onChange })
    const input = getInput()
    act(() => input.focus())

    const notPrevented = dispatchKey(input, 'Enter')
    expect(notPrevented).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('CountrySelect — Escape', () => {
  it('closes the list without picking or clearing anything', () => {
    const onChange = vi.fn()
    mount({ label: 'Home country', value: 'NL', onChange })
    const input = getInput()
    act(() => input.focus())
    expect(container.querySelector('[role="listbox"]')).not.toBeNull()

    dispatchKey(input, 'Escape')

    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toContain('Netherlands')
  })
})

describe('CountrySelect — blur reverts an unpicked draft', () => {
  it('falls back to the selected country, without calling onChange', () => {
    const onChange = vi.fn()
    mount({ label: 'Home country', value: 'NL', onChange })
    const input = getInput()
    act(() => input.focus())
    typeInto(input, 'this is not a country')
    expect(input.value).toBe('this is not a country')

    act(() => input.blur())

    expect(input.value).toContain('Netherlands')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('CountrySelect — clearing', () => {
  it('the clear button drops the value and refocuses the field', () => {
    const onChange = vi.fn()
    mount({ label: 'Home country', value: 'NL', onChange })
    const clearButton = container.querySelector('button[aria-label="Clear home country"]')!
    click(clearButton)

    expect(onChange).toHaveBeenCalledWith(null)
    expect(document.activeElement).toBe(getInput())
  })

  it('shows no clear button when nothing is picked and the field is empty', () => {
    mount({ label: 'Home country', value: null, onChange: vi.fn() })
    expect(container.querySelector('button[aria-label="Clear home country"]')).toBeNull()
  })
})

describe('CountrySelect — form + a11y wiring', () => {
  it('writes a hidden input carrying the code when `name` is passed', () => {
    mount({ label: 'Home country', value: 'NL', onChange: vi.fn(), name: 'homeCountry' })
    const hidden = container.querySelector<HTMLInputElement>('input[name="homeCountry"]')!
    expect(hidden.type).toBe('hidden')
    expect(hidden.value).toBe('NL')
  })

  it('writes no hidden input at all when `name` is omitted', () => {
    mount({ label: 'Home country', value: 'NL', onChange: vi.fn() })
    expect(container.querySelectorAll('input').length).toBe(1) // the combobox itself, nothing else
  })

  it('associates the error message via aria-describedby', () => {
    mount({ label: 'Home country', value: null, onChange: vi.fn(), error: 'Pick a country.' })
    const input = getInput()
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Pick a country.')
  })

  it('marks aria-invalid only when there is an error', () => {
    mount({ label: 'Home country', value: null, onChange: vi.fn() })
    expect(getInput().getAttribute('aria-invalid')).toBeNull()
  })
})

describe('normalizeCountryQuery', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeCountryQuery('Curaçao')).toBe('curacao')
    expect(normalizeCountryQuery('  Côte d’Ivoire ')).toBe('cote d’ivoire')
  })
})

describe('filterCountryOptions', () => {
  const options = [
    { code: 'AD', name: 'Andorra' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'CW', name: 'Curaçao' },
  ]

  it('returns everything for an empty query', () => {
    expect(filterCountryOptions('', options)).toEqual(options)
    expect(filterCountryOptions('   ', options)).toEqual(options)
  })

  it('matches the name case-insensitively', () => {
    expect(filterCountryOptions('NETHER', options)).toEqual([options[1]])
  })

  it('matches the name accent-insensitively', () => {
    expect(filterCountryOptions('curacao', options)).toEqual([options[2]])
  })

  it('matches the ISO code', () => {
    expect(filterCountryOptions('ad', options)).toEqual([options[0]])
  })

  it('returns nothing for a query that matches neither name nor code', () => {
    expect(filterCountryOptions('zzzzz', options)).toEqual([])
  })
})

describe('resolveCountryKey', () => {
  const open = { open: true, optionCount: 3, activeIndex: -1 }

  it('selects on Enter only with a highlighted option', () => {
    expect(resolveCountryKey('Enter', { ...open, activeIndex: 1 })).toEqual({ type: 'select' })
    expect(resolveCountryKey('Enter', open)).toEqual({ type: 'none' })
    expect(resolveCountryKey('Enter', { ...open, open: false, activeIndex: 1 })).toEqual({
      type: 'none',
    })
  })

  it('closes on Escape only while open', () => {
    expect(resolveCountryKey('Escape', open)).toEqual({ type: 'close' })
    expect(resolveCountryKey('Escape', { ...open, open: false })).toEqual({ type: 'none' })
  })

  it('opens on an arrow key when closed, and moves when open', () => {
    expect(resolveCountryKey('ArrowDown', { ...open, open: false })).toEqual({ type: 'open' })
    expect(resolveCountryKey('ArrowDown', open)).toEqual({ type: 'move', delta: 1 })
    expect(resolveCountryKey('ArrowUp', open)).toEqual({ type: 'move', delta: -1 })
  })

  it('does nothing on an arrow key with no options', () => {
    expect(resolveCountryKey('ArrowDown', { ...open, optionCount: 0 })).toEqual({ type: 'none' })
  })

  it('ignores every other key', () => {
    for (const key of ['a', 'Tab', ' ', 'Shift']) {
      expect(resolveCountryKey(key, open)).toEqual({ type: 'none' })
    }
  })
})

describe('wrapCountryIndex', () => {
  it('wraps from before the start to the last option', () => {
    expect(wrapCountryIndex(-1, 1, 3)).toBe(0)
    expect(wrapCountryIndex(-1, -1, 3)).toBe(2)
  })

  it('wraps past the end back to the first option', () => {
    expect(wrapCountryIndex(2, 1, 3)).toBe(0)
    expect(wrapCountryIndex(0, -1, 3)).toBe(2)
  })

  it('has nothing to land on with zero options', () => {
    expect(wrapCountryIndex(0, 1, 0)).toBe(-1)
  })
})
