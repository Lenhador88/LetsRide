import { describe, expect, it } from 'vitest'
import { nearLabel } from '@/lib/location/near-label'
import type { RiderLocation } from '@/lib/location/rider-location'

const at = (source: RiderLocation['source']): RiderLocation => ({
  lat: 52.09,
  lon: 5.12,
  source,
})

/**
 * The rule this function exists for: **the name must come from the same source
 * as the number.** Every case below is a sentence the Explore strip can render,
 * checked for whether it is true.
 */
describe('nearLabel', () => {
  it('names the profile city when the position IS that city', () => {
    expect(nearLabel(at('profile'), 'Utrecht')).toEqual({ name: 'Utrecht' })
  })

  it('says "you" for a device fix, even when a profile city exists', () => {
    // The defect this prevents: a rider whose profile says Utrecht, who has
    // granted location, and who is in Maastricht. The distances are from
    // Maastricht, so `near Utrecht` is false about every club on the screen.
    expect(nearLabel(at('device'), 'Utrecht')).toEqual({ name: 'you' })
  })

  it('says nothing at all with no position — no claim of proximity', () => {
    expect(nearLabel(null, 'Utrecht')).toBeNull()
    expect(nearLabel(undefined, 'Utrecht')).toBeNull()
  })

  it('strips the country a rider typed after their town', () => {
    // `profiles.location` is free text and riders fill it four ways.
    expect(nearLabel(at('profile'), 'Amsterdam, Netherlands')).toEqual({ name: 'Amsterdam' })
    expect(nearLabel(at('profile'), 'Amsterdam, NL')).toEqual({ name: 'Amsterdam' })
  })

  it('falls back to "you" for a profile position whose city will not reduce', () => {
    // The geocode answered but `localityOf` declines the string. The distances
    // on screen are still real, so "near you" is true where dropping the claim
    // would be needlessly silent.
    expect(nearLabel(at('profile'), '   ')).toEqual({ name: 'you' })
    expect(nearLabel(at('profile'), null)).toEqual({ name: 'you' })
  })
})
