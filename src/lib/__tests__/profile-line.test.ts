import { describe, expect, it } from 'vitest'
import { profileLocationLine } from '@/lib/profile-line'

describe('profileLocationLine — PD-476', () => {
  it("shows the rider's own words when they have written some", () => {
    expect(profileLocationLine({ rides_from: 'the wrong side of the Maas', location: 'Hoorn' })).toBe(
      'the wrong side of the Maas'
    )
  })

  it('falls back to the placed town, so no profile lost its line when 127 shipped', () => {
    expect(profileLocationLine({ rides_from: null, location: 'Hoorn' })).toBe('Hoorn')
  })

  it('draws nothing when there is neither', () => {
    expect(profileLocationLine({ rides_from: null, location: null })).toBeNull()
  })
})
