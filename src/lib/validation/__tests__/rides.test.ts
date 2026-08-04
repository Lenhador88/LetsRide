import { describe, expect, it } from 'vitest'
import { parseRideFilter } from '@/lib/validation/rides'

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('parseRideFilter', () => {
  it('reads the three filters the screen has', () => {
    expect(parseRideFilter({})).toBeUndefined()
    expect(parseRideFilter({ filter: 'mine' })).toEqual({ kind: 'mine' })
    expect(parseRideFilter({ club: UUID })).toEqual({ kind: 'club', id: UUID })
  })

  it('drops a club id that is not a uuid, rather than passing it to the query', () => {
    // The whole point: this used to reach `.eq('club_id', …)`, and Postgres
    // answers a malformed uuid with 22P02 → 400 → the rides tab's error
    // boundary. "No filter" is the honest response to a stale link.
    expect(parseRideFilter({ club: 'not-a-uuid' })).toBeUndefined()
    expect(parseRideFilter({ club: '' })).toBeUndefined()
    expect(parseRideFilter({ club: "'; drop table rides; --" })).toBeUndefined()
  })

  it('ignores a filter value it does not know', () => {
    expect(parseRideFilter({ filter: 'everyone' })).toBeUndefined()
  })

  it('lets "mine" win over a club, rather than intersecting them', () => {
    expect(parseRideFilter({ filter: 'mine', club: UUID })).toEqual({ kind: 'mine' })
  })

  it('still returns the club when only the filter value is junk', () => {
    expect(parseRideFilter({ filter: 'bogus', club: UUID })).toEqual({ kind: 'club', id: UUID })
  })
})
