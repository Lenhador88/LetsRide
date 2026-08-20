import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHOTO_LOCATION_MODE,
  NO_PHOTO_LOCATION,
  resolvePhotoLocation,
  roundToCoarseGrid,
} from '../location'

const AMSTERDAM = { latitude: 52.370216, longitude: 4.895168 }
const NO_FIX = { latitude: null, longitude: null }

/** A picked place: a name and the pin that came with it. */
const PICKED = { name: 'Amsterdam', lat: 52.370216, lon: 4.895168 }
/** A typed place: a name and nothing else, which is a first-class state. */
const TYPED = { name: 'Amsterdam', lat: null, lon: null }

describe('roundToCoarseGrid', () => {
  it('keeps two decimal places', () => {
    expect(roundToCoarseGrid(52.370216)).toBe(52.37)
    expect(roundToCoarseGrid(4.895168)).toBe(4.9)
  })

  it('rounds toward the nearer grid line in both directions', () => {
    expect(roundToCoarseGrid(-3.456)).toBe(-3.46)
    expect(roundToCoarseGrid(-3.454)).toBe(-3.45)
  })

  it('is idempotent — a rounded value survives being rounded again', () => {
    const once = roundToCoarseGrid(52.370216)
    expect(roundToCoarseGrid(once)).toBe(once)
  })

  it('produces a value that is exactly a hundredth, which is what the database CHECK asks', () => {
    for (const raw of [52.370216, 4.895168, -0.00499, 179.99999, -89.98765, 0]) {
      const rounded = roundToCoarseGrid(raw)
      expect(Number.isInteger(Math.round(rounded * 100))).toBe(true)
      expect(rounded).toBe(Math.round(rounded * 100) / 100)
    }
  })

  it('never moves a point by more than about a kilometre of latitude', () => {
    // Half a hundredth of a degree is the worst case, ~550m.
    for (const raw of [52.370216, -12.3456789, 0.009, 89.999]) {
      expect(Math.abs(roundToCoarseGrid(raw) - raw)).toBeLessThanOrEqual(0.005 + 1e-9)
    }
  })
})

describe('resolvePhotoLocation', () => {
  it('opens on hide', () => {
    expect(DEFAULT_PHOTO_LOCATION_MODE).toBe('hide')
  })

  it('sends nothing on hide, even with a photo fix AND a place the rider named', () => {
    // The one that matters: a rider who named a town, thought better of it and
    // went back to Hide must not publish the town they typed.
    expect(resolvePhotoLocation('hide', AMSTERDAM, PICKED)).toEqual(NO_PHOTO_LOCATION)
    expect(resolvePhotoLocation('hide', NO_FIX, TYPED)).toEqual(NO_PHOTO_LOCATION)
  })

  it('stores a picked place rounded, with its provenance — arm 3', () => {
    expect(resolvePhotoLocation('place', AMSTERDAM, PICKED)).toEqual({
      latitude: 52.37,
      longitude: 4.9,
      precision: 'place',
      placeName: 'Amsterdam',
    })
  })

  it('stores a typed place as a name with no pin and no id — arm 2', () => {
    expect(resolvePhotoLocation('place', AMSTERDAM, TYPED)).toEqual({
      latitude: null,
      longitude: null,
      precision: 'place',
      placeName: 'Amsterdam',
    })
  })

  it('never lets the photo fix leak into a named place', () => {
    // The forbidden direction: the rider asked for a town, so the camera's own
    // coordinate must not be what gets stored under it.
    const named = resolvePhotoLocation('place', AMSTERDAM, PICKED)
    expect(named.latitude).not.toBe(AMSTERDAM.latitude)
    expect(named.longitude).not.toBe(AMSTERDAM.longitude)
    const typed = resolvePhotoLocation('place', AMSTERDAM, TYPED)
    expect(typed.latitude).toBeNull()
    expect(typed.longitude).toBeNull()
  })

  it('treats a named place with nothing named as hide, rather than a partial row', () => {
    expect(resolvePhotoLocation('place', AMSTERDAM, null)).toEqual(NO_PHOTO_LOCATION)
    expect(resolvePhotoLocation('place', AMSTERDAM, { ...TYPED, name: '   ' })).toEqual(
      NO_PHOTO_LOCATION
    )
  })

  it('rounds a picked STREET too, because the typeahead returns streets', () => {
    // The label may be as specific as the rider likes; the coordinate may not.
    const street = { name: 'Kerkstraat 40', lat: 52.363214, lon: 4.883333 }
    const resolved = resolvePhotoLocation('place', NO_FIX, street)
    expect(resolved.latitude).toBe(52.36)
    expect(resolved.longitude).toBe(4.88)
    expect(resolved.placeName).toBe('Kerkstraat 40')
  })

  it('sends the full value and says so on precise — arm 4', () => {
    expect(resolvePhotoLocation('precise', AMSTERDAM, null)).toEqual({
      latitude: 52.370216,
      longitude: 4.895168,
      precision: 'precise',
      placeName: null,
    })
  })

  it('keeps a name as a LABEL under precise — a caption, not evidence', () => {
    expect(resolvePhotoLocation('precise', AMSTERDAM, PICKED)).toEqual({
      latitude: 52.370216,
      longitude: 4.895168,
      precision: 'precise',
      placeName: 'Amsterdam',
    })
  })

  it('yields nothing under precise when the photo carried no location', () => {
    expect(resolvePhotoLocation('precise', NO_FIX, PICKED)).toEqual(NO_PHOTO_LOCATION)
  })

  it('refuses a half pair rather than storing one coordinate', () => {
    expect(resolvePhotoLocation('precise', { latitude: 52.37, longitude: null }, null)).toEqual(
      NO_PHOTO_LOCATION
    )
    expect(resolvePhotoLocation('precise', { latitude: null, longitude: 4.9 }, null)).toEqual(
      NO_PHOTO_LOCATION
    )
    // And on the named side: a place carrying half a pin is stored as a name.
    expect(
      resolvePhotoLocation('place', NO_FIX, { name: 'Amsterdam', lat: 52.37, lon: null })
    ).toEqual({
      latitude: null,
      longitude: null,
      precision: 'place',
      placeName: 'Amsterdam',
    })
  })

  it('handles the equator and the prime meridian without treating 0 as absent', () => {
    expect(resolvePhotoLocation('precise', { latitude: 0, longitude: 0 }, null)).toEqual({
      latitude: 0,
      longitude: 0,
      precision: 'precise',
      placeName: null,
    })
  })
})
