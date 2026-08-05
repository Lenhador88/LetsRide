import { describe, expect, it } from 'vitest'
import { parseRideFilter, rideIdSchema } from '@/lib/validation/rides'

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

describe('rideIdSchema', () => {
  it('accepts a uuid', () => {
    expect(rideIdSchema.safeParse('dd7c6d53-3a12-481c-96f6-efd5249693b4').success).toBe(true)
  })

  it('rejects the segments that actually reached it in production', () => {
    // `/rides/new` is the Create-ride button's own href, and it matches the
    // `/rides/[id]` route for any segment that is not a real sub-route. Before
    // this schema, `/rides/new/crew` answered 500 — Postgres 22P02 through
    // PostgREST as a 400, thrown by unwrap. Found by loading the app, not by
    // review.
    for (const bad of ['new', 'not-a-uuid', '', '123', 'undefined', 'null']) {
      expect(rideIdSchema.safeParse(bad).success).toBe(false)
    }
  })
})
