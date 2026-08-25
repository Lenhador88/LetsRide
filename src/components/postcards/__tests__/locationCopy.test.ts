import { describe, expect, it } from 'vitest'
import { LOCATION_MODES, resolveLocationCopy } from '../locationCopy'

/**
 * The two states this function exists for are the ones where a mode is selected
 * and the row it would write is empty. Both were shipped wrong once — `Region`
 * found by review on 2026-08-20, `Precise` by the product owner the same day —
 * and both are invisible on screen: the rider is told something is saved and
 * the database says otherwise.
 */
describe('resolveLocationCopy', () => {
  it('never claims a save on ANY saving mode that would store nothing', () => {
    // `hide` is excluded because its own true sentence is "Nothing is saved" —
    // a substring sweep that included it would either fail on the truth or be
    // loosened until it caught nothing. The saving modes are the ones that can
    // lie, and the assertion is on the LEAD, which is the line a rider reads
    // first and the one that makes the claim.
    for (const { value } of LOCATION_MODES.filter((m) => m.value !== 'hide')) {
      for (const hasPhotoFix of [true, false]) {
        expect(resolveLocationCopy(value, null, hasPhotoFix).lead).toBe('Nothing to save yet.')
      }
    }
  })

  it('tells a rider in Region mode with an empty field that nothing is stored yet', () => {
    const { lead, hint } = resolveLocationCopy('place', null, false)
    expect(lead).toBe('Nothing to save yet.')
    expect(hint).toContain('Name a place above')
  })

  it('names the mode that still works when Precise has nothing to be exact about', () => {
    // The advice must not be "name a place": only a PICKED place counts, and
    // picking needs a geocoder that is unavailable offline or once the hourly
    // ceiling is spent. Region always works.
    const { lead, hint } = resolveLocationCopy('precise', null, false)
    expect(lead).toBe('Nothing to save yet.')
    expect(hint).toContain('Pick a place from the list')
    expect(hint).toContain('Region')
  })

  it('distinguishes the photo fix from a picked place under Precise', () => {
    const fromPhoto = resolveLocationCopy('precise', 'precise', true)
    const fromPick = resolveLocationCopy('precise', 'precise', false)
    expect(fromPhoto.hint).toContain('where you took the photo')
    expect(fromPick.hint).toContain('not where the photo was taken')
    expect(fromPhoto.hint).not.toBe(fromPick.hint)
  })

  it('uses the constant sentence for Region once a place is actually stored', () => {
    const entry = LOCATION_MODES.find((m) => m.value === 'place')!
    expect(resolveLocationCopy('place', 'place', false)).toEqual({
      lead: entry.lead,
      hint: entry.hint,
    })
  })

  it('never varies Hide, which stores nothing in every state', () => {
    const entry = LOCATION_MODES.find((m) => m.value === 'hide')!
    for (const stored of [null, 'place', 'precise'] as const) {
      for (const hasPhotoFix of [true, false]) {
        expect(resolveLocationCopy('hide', stored, hasPhotoFix)).toEqual({
          lead: entry.lead,
          hint: entry.hint,
        })
      }
    }
  })

  it('labels the middle mode Region while its stored marker stays place', () => {
    // The two words are deliberately different — `'region'` is still live in the
    // column under 064's ~1 km meaning. See the note in LOCATION_MODES.
    const entry = LOCATION_MODES.find((m) => m.value === 'place')!
    expect(entry.label).toBe('Region')
  })
})
