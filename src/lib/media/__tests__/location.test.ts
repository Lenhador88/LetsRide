import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHOTO_LOCATION_MODE,
  NO_PHOTO_LOCATION,
  resolvePhotoLocation,
  roundToRegion,
} from '../location'

const AMSTERDAM = { latitude: 52.370216, longitude: 4.895168 }

describe('roundToRegion', () => {
  it('keeps two decimal places', () => {
    expect(roundToRegion(52.370216)).toBe(52.37)
    expect(roundToRegion(4.895168)).toBe(4.9)
  })

  it('rounds toward the nearer grid line in both directions', () => {
    expect(roundToRegion(-3.456)).toBe(-3.46)
    expect(roundToRegion(-3.454)).toBe(-3.45)
  })

  it('is idempotent — a rounded value survives being rounded again', () => {
    const once = roundToRegion(52.370216)
    expect(roundToRegion(once)).toBe(once)
  })

  it('produces a value that is exactly a hundredth, which is what the database CHECK asks', () => {
    for (const raw of [52.370216, 4.895168, -0.00499, 179.99999, -89.98765, 0]) {
      const rounded = roundToRegion(raw)
      expect(Number.isInteger(Math.round(rounded * 100))).toBe(true)
      expect(rounded).toBe(Math.round(rounded * 100) / 100)
    }
  })

  it('never moves a point by more than about a kilometre of latitude', () => {
    // Half a hundredth of a degree is the worst case, ~550m.
    for (const raw of [52.370216, -12.3456789, 0.009, 89.999]) {
      expect(Math.abs(roundToRegion(raw) - raw)).toBeLessThanOrEqual(0.005 + 1e-9)
    }
  })
})

describe('resolvePhotoLocation', () => {
  it('opens on hide', () => {
    expect(DEFAULT_PHOTO_LOCATION_MODE).toBe('hide')
  })

  it('sends nothing at all on hide, even when the photo carried a location', () => {
    expect(resolvePhotoLocation('hide', AMSTERDAM)).toEqual(NO_PHOTO_LOCATION)
  })

  it('rounds and marks the mode on region', () => {
    expect(resolvePhotoLocation('region', AMSTERDAM)).toEqual({
      latitude: 52.37,
      longitude: 4.9,
      precision: 'region',
    })
  })

  it('sends the full value and says so on precise', () => {
    expect(resolvePhotoLocation('precise', AMSTERDAM)).toEqual({
      latitude: 52.370216,
      longitude: 4.895168,
      precision: 'precise',
    })
  })

  it('never marks a precise value as region — the marker and the value are produced together', () => {
    const region = resolvePhotoLocation('region', AMSTERDAM)
    expect(region.latitude).not.toBe(AMSTERDAM.latitude)
    expect(region.longitude).not.toBe(AMSTERDAM.longitude)
  })

  it('yields nothing when the photo carried no location, whatever the mode says', () => {
    const none = { latitude: null, longitude: null }
    expect(resolvePhotoLocation('precise', none)).toEqual(NO_PHOTO_LOCATION)
    expect(resolvePhotoLocation('region', none)).toEqual(NO_PHOTO_LOCATION)
  })

  it('refuses a half pair rather than storing one coordinate', () => {
    expect(resolvePhotoLocation('precise', { latitude: 52.37, longitude: null })).toEqual(
      NO_PHOTO_LOCATION
    )
    expect(resolvePhotoLocation('precise', { latitude: null, longitude: 4.9 })).toEqual(
      NO_PHOTO_LOCATION
    )
  })

  it('handles the equator and the prime meridian without treating 0 as absent', () => {
    expect(resolvePhotoLocation('precise', { latitude: 0, longitude: 0 })).toEqual({
      latitude: 0,
      longitude: 0,
      precision: 'precise',
    })
  })
})
