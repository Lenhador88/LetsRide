import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  PlaceDataCredit,
  PlaceSearchField,
  boundName,
  placeLabel,
  resolveComboboxKey,
  wrapIndex,
} from '@/components/ui/PlaceSearchField'
import type { PlaceSearchResult } from '@/types'

/**
 * What a picked place is STORED as (PD-259). Only the pure half is covered —
 * the list needs a layout and an event loop, and this repo's Vitest
 * environment is `node` (see `CLAUDE.md`'s test table: jsdom is the answer only
 * when something needs a layout, and one label function does not). PD-274's
 * answer to that is `resolveComboboxKey`: the two keyboard rules that would
 * otherwise have no gate are a pure decision, tested below.
 */
const place = (over: Partial<PlaceSearchResult> = {}): PlaceSearchResult => ({
  id: 'gers-1',
  label: 'Shell Pernis Werk',
  meta: 'Petroleumweg, Vondelingenplaat',
  lat: 51.88,
  lon: 4.36,
  countryCode: null,
  timezone: null,
  ...over,
})

describe('placeLabel', () => {
  it('appends the locality, because a place name alone is often unplaceable', () => {
    expect(placeLabel(place())).toBe('Shell Pernis Werk, Vondelingenplaat')
  })

  it('does not stutter when the place IS its locality', () => {
    expect(placeLabel(place({ label: 'Utrecht', meta: 'Utrecht' }))).toBe('Utrecht')
  })

  it('matches the locality case-insensitively — Overture disagrees with itself', () => {
    expect(placeLabel(place({ label: 'Utrecht', meta: 'utrecht' }))).toBe('Utrecht')
  })

  it('falls back to the label alone when there is no meta line', () => {
    expect(placeLabel(place({ meta: null }))).toBe('Shell Pernis Werk')
    expect(placeLabel(place({ meta: '' }))).toBe('Shell Pernis Werk')
  })

  it('takes the LAST segment of meta, which is the locality rather than the street', () => {
    expect(placeLabel(place({ label: 'Bar', meta: 'Kerkstraat, Weena, Rotterdam' }))).toBe(
      'Bar, Rotterdam'
    )
  })

  it('ignores a trailing comma rather than appending an empty locality', () => {
    expect(placeLabel(place({ label: 'Bar', meta: 'Kerkstraat,' }))).toBe('Bar')
  })
})

describe('boundName', () => {
  it('leaves a name inside the bound alone', () => {
    expect(boundName('Utrecht', 200)).toBe('Utrecht')
    expect(boundName('x'.repeat(200), 200)).toBe('x'.repeat(200))
  })

  it('never returns more characters than the bound', () => {
    // The whole point: `places.name` reaches 203 on the real index and the
    // label built from it reaches 214, against a CHECK of 200. A picker that
    // can return an unstorable value is a dead end the rider cannot escape.
    const bounded = boundName('x'.repeat(214), 200)
    expect(bounded.length).toBe(200)
    expect(bounded.endsWith('\u2026')).toBe(true)
  })

  it('keeps the ellipsis INSIDE the budget rather than adding to it', () => {
    // Overshooting by one is the same bug arriving through the fix for it.
    expect(boundName('abcdef', 4)).toBe('abc\u2026')
    expect(boundName('abcdef', 4).length).toBe(4)
  })

  it('does not leave a dangling space before the ellipsis', () => {
    expect(boundName('Shell Pernis Werk', 7)).toBe('Shell\u2026')
  })

  it('applies no bound when the caller has no column limit', () => {
    expect(boundName('x'.repeat(500))).toBe('x'.repeat(500))
  })
})

/**
 * The two modes' FORM SHAPE, which is the part a caller's action depends on —
 * PD-114.
 *
 * Rendered through `renderToStaticMarkup` rather than jsdom, the same way
 * `PostcardAction` is: this asserts what markup the field produces, and needs
 * no layout and no event loop. The list is deliberately out of reach — it
 * renders only once the field has focus — so what is covered here is the field
 * at rest, plus the credit, which is its own component for exactly that
 * reason.
 */
describe('PlaceSearchField form shape', () => {
  const names = {
    name: 'meeting_point',
    placeId: 'start_place_id',
    lat: 'latitude',
    lon: 'longitude',
  }
  const clubNames = {
    name: 'location_name',
    placeId: 'location_place_id',
    lat: 'latitude',
    lon: 'longitude',
  }
  const noop = () => {}

  it('place mode writes FOUR hidden inputs, and its visible input is nameless', () => {
    const html = renderToStaticMarkup(
      <PlaceSearchField
        label="Location"
        value={null}
        onChange={noop}
        names={clubNames}
      />
    )
    expect(html.match(/type="hidden"/g)).toHaveLength(4)
    expect(html).toContain('name="location_name"')
    // PD-274 made this a search box the rider types in, which is exactly why
    // it carries no `name`: `location_name` stays the HIDDEN input, so typed
    // text that was never picked cannot be submitted as a stored location.
    // The whole club-mode safety case is this one attribute.
    expect(html).toContain('type="text"')
    expect(html.match(/name="location_name"/g)).toHaveLength(1)
    expect(html).not.toContain('type="text" name=')
  })

  it('writes NO form fields at all when the caller passes no names', () => {
    // The postcard composer's case: the pick is an input to a decision made by
    // the buttons under this field, not a value to submit. A hidden input
    // carrying the town would travel under `Hide`, whose whole promise is that
    // nothing does.
    const html = renderToStaticMarkup(
      <PlaceSearchField
        label="Location"
        value={{ name: 'Amsterdam', placeId: 'geoapify:x', lat: 52.37, lon: 4.9 }}
        onChange={noop}
      />
    )
    expect(html).not.toContain('type="hidden"')
    expect(html).not.toContain('name=')
  })

  it('free-text mode makes the NAME field editable and keeps the other three hidden', () => {
    const html = renderToStaticMarkup(
      <PlaceSearchField
        label="Starting location"
        value={null}
        onChange={noop}
        names={names}
        freeText={{ text: 'the layby past the second roundabout', onTextChange: noop, required: true }}
      />
    )
    // Three, not four: `meeting_point` is the rider's own input now.
    expect(html.match(/type="hidden"/g)).toHaveLength(3)
    expect(html).toContain('type="text"')
    expect(html).toContain('name="meeting_point"')
    expect(html).toContain('value="the layby past the second roundabout"')
    // `meeting_point` is NOT NULL, so the field carries the requirement.
    expect(html).toContain('required=""')
  })

  it('carries a pick through all three hidden fields', () => {
    const html = renderToStaticMarkup(
      <PlaceSearchField
        label="Starting location"
        value={{ name: 'Shell Pernis Werk', placeId: 'gers-1', lat: 51.88, lon: 4.36 }}
        onChange={noop}
        names={names}
        freeText={{ text: 'Shell Pernis Werk', onTextChange: noop, required: true }}
      />
    )
    expect(html).toContain('name="start_place_id" value="gers-1"')
    expect(html).toContain('name="latitude" value="51.88"')
    expect(html).toContain('name="longitude" value="4.36"')
  })

  it('writes empty strings, never a partial pick, when nothing is picked', () => {
    // `readRideLocation` reads all-or-nothing off these three, and `Number('')`
    // is 0 — a real coordinate in the Gulf of Guinea. Empty is what makes the
    // string test possible.
    const html = renderToStaticMarkup(
      <PlaceSearchField
        label="Starting location"
        value={null}
        onChange={noop}
        names={names}
        freeText={{ text: 'behind the church', onTextChange: noop, required: true }}
      />
    )
    expect(html).toContain('name="start_place_id" value=""')
    expect(html).toContain('name="latitude" value=""')
    expect(html).toContain('name="longitude" value=""')
  })
})

describe('PlaceDataCredit', () => {
  it('links to the page that pays the Geoapify/OpenStreetMap credit — PD-273', () => {
    // The proxy's OpenStreetMap credit is unconditional and a list of
    // results carries no burned-in credit of its own, so this line is the
    // whole obligation — one link, not a per-result or per-source line.
    // Overture is gone with the index it credited (070).
    const html = renderToStaticMarkup(<PlaceDataCredit />)
    expect(html).toContain('href="/legal/attributions"')
    expect(html).toContain('Geoapify')
    expect(html).toContain('OpenStreetMap')
    expect(html).not.toContain('Overture')
  })
})

/**
 * The two keyboard rules a rider notices only when they are wrong — PD-274.
 *
 * Pure, and tested here rather than through jsdom, for the reason
 * `src/lib/auth/guard.ts` is: the decision is the part worth asserting, and an
 * event-capable environment would be a devDependency bought for two rules that
 * do not need one.
 */
describe('resolveComboboxKey', () => {
  const open = { open: true, optionCount: 3, activeIndex: -1 }

  it('selects on Enter when an option is active, so the form is NOT submitted', () => {
    // The defect this prevents: a rider picks a suggestion on CreateRideForm,
    // the form submits half-filled, the submit is refused, and they blame the
    // field. The caller only calls preventDefault for a non-`none` action.
    expect(resolveComboboxKey('Enter', { ...open, activeIndex: 1 })).toEqual({ type: 'select' })
  })

  it('leaves Enter alone when nothing is active, so the form submits as it always did', () => {
    expect(resolveComboboxKey('Enter', open)).toEqual({ type: 'none' })
    expect(resolveComboboxKey('Enter', { ...open, open: false, activeIndex: 1 })).toEqual({
      type: 'none',
    })
    // An active index left over from a longer list must not select a row that
    // is no longer there.
    expect(resolveComboboxKey('Enter', { ...open, optionCount: 1, activeIndex: 2 })).toEqual({
      type: 'none',
    })
  })

  it('closes on Escape and does nothing else — never clears, never submits', () => {
    expect(resolveComboboxKey('Escape', open)).toEqual({ type: 'close' })
  })

  it('leaves Escape alone when the list is already closed', () => {
    // So it can reach whatever a rider expects Escape to do on the form.
    expect(resolveComboboxKey('Escape', { ...open, open: false })).toEqual({ type: 'none' })
  })

  it('opens a closed list on an arrow key rather than moving an invisible cursor', () => {
    expect(resolveComboboxKey('ArrowDown', { ...open, open: false })).toEqual({ type: 'open' })
  })

  it('moves in both directions while the list is open', () => {
    expect(resolveComboboxKey('ArrowDown', open)).toEqual({ type: 'move', delta: 1 })
    expect(resolveComboboxKey('ArrowUp', open)).toEqual({ type: 'move', delta: -1 })
  })

  it('does nothing with arrows when there is nothing to move through', () => {
    expect(resolveComboboxKey('ArrowDown', { ...open, optionCount: 0 })).toEqual({ type: 'none' })
  })

  it('ignores every other key, including the ones that type', () => {
    for (const key of ['a', ' ', 'Tab', 'Home', 'End', 'Backspace']) {
      expect(resolveComboboxKey(key, open)).toEqual({ type: 'none' })
    }
  })
})

describe('wrapIndex', () => {
  it('starts at the first row going down and the last going up', () => {
    expect(wrapIndex(-1, 1, 3)).toBe(0)
    expect(wrapIndex(-1, -1, 3)).toBe(2)
  })

  it('wraps at both ends', () => {
    expect(wrapIndex(2, 1, 3)).toBe(0)
    expect(wrapIndex(0, -1, 3)).toBe(2)
  })

  it('has nothing to point at in an empty list', () => {
    expect(wrapIndex(0, 1, 0)).toBe(-1)
  })
})
