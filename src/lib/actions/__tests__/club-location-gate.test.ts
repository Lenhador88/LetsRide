import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `createClub` and `updateClub` against the location — PD-446.
 *
 * **The schema tests next door prove the two schemas differ; this proves the
 * two ACTIONS use the different ones.** That is a separate failure and the more
 * likely one: `clubCreateSchema` can be perfectly correct while `createClub`
 * still parses `clubSchema`, and every schema assertion stays green. `tsc`
 * cannot see it either — both schemas accept the same object shape, and the
 * only difference is a runtime refusal.
 *
 * The pairing that matters, asserted in both directions:
 *
 * - **`createClub` with no location writes NOTHING.** Not a row with four
 *   NULLs — nothing at all, because the parse fails before the client is even
 *   resolved.
 * - **`updateClub` on a club with no location SUCCEEDS**, and writes all four
 *   columns as NULL. That is the population this change must not break, and
 *   measured 2026-09-08 it is empty on both projects — DEV 15/15 and PROD 2/2
 *   clubs carry a location — so this test is the only thing standing behind the
 *   contract.
 */
const inserted: Array<Record<string, unknown>> = []
const updated: Array<Record<string, unknown>> = []

const insert = vi.fn((values: Record<string, unknown>) => {
  inserted.push(values)
  return { select: () => ({ single: async () => ({ data: { id: 'club-1' }, error: null }) }) }
})

const update = vi.fn((values: Record<string, unknown>) => {
  updated.push(values)
  return {
    eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'club-1' }, error: null }) }) }),
  }
})

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({
    from: () => ({
      insert,
      update,
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
    auth: { getUser: async () => ({ data: { user: { id: 'rider-1' } } }) },
  }),
}))

vi.mock('@/lib/query', () => ({ invalidate: () => {} }))
vi.mock('@/lib/analytics/client', () => ({ capture: () => {} }))

import { createClub, updateClub } from '@/lib/actions/clubs'
import { emptyActionState } from '@/lib/actions/state'

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

const pick = {
  location_name: 'Utrecht',
  location_place_id: '08f196a0e0a2c8f0039e5f2a7f6d1c3b',
  latitude: '52.0907',
  longitude: '5.1214',
}

const withLocation = { name: 'Ochtend Rijders', description: '', ...pick }

const withoutLocation = { name: 'Ochtend Rijders', description: '' }

beforeEach(() => {
  inserted.length = 0
  updated.length = 0
  insert.mockClear()
  update.mockClear()
})

describe('createClub requires a location', () => {
  it('refuses a club with no location and inserts nothing', () => {
    return createClub(emptyActionState, form(withoutLocation)).then((result) => {
      expect(result.error).toBe('Pick where your club is based.')
      // The half that a "returns an error" assertion alone would miss: the
      // parse fails before the client is resolved, so no row is written and no
      // orphaned club is left behind for the rider to find later.
      expect(insert).not.toHaveBeenCalled()
      expect(inserted).toHaveLength(0)
    })
  })

  it('accepts a club that carries one, and writes all four columns', async () => {
    const result = await createClub(emptyActionState, form(withLocation))
    expect(result.error).toBeNull()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      location_name: 'Utrecht',
      location_place_id: '08f196a0e0a2c8f0039e5f2a7f6d1c3b',
      latitude: 52.0907,
      longitude: 5.1214,
    })
    // `location` is destructured out rather than spread: it is one object in
    // the schema and four columns in the table, and posting the key answers
    // PGRST204.
    expect(inserted[0]).not.toHaveProperty('location')
  })

  it('refuses a partial hidden-field set, which is what a half-used picker posts', async () => {
    const result = await createClub(
      emptyActionState,
      form({ name: 'Ochtend Rijders', description: '', location_name: 'Utrecht' })
    )
    expect(result.error).toBe('Pick where your club is based.')
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('updateClub does NOT — the population this must not break', () => {
  it('saves a club that has no location, writing all four columns NULL', async () => {
    const result = await updateClub('club-1', emptyActionState, form(withoutLocation))
    expect(result.error).toBeNull()
    expect(updated).toHaveLength(1)
    // All four keys present on the null branch: an update that omitted them
    // would leave a stale location standing while the form said otherwise.
    expect(updated[0]).toMatchObject({
      location_name: null,
      location_place_id: null,
      latitude: null,
      longitude: null,
    })
  })

  it('still lets an owner add a location on the edit path', async () => {
    const result = await updateClub('club-1', emptyActionState, form(withLocation))
    expect(result.error).toBeNull()
    expect(updated[0]).toMatchObject({ location_name: 'Utrecht', latitude: 52.0907 })
  })

  it('refuses a nameless club on BOTH paths, so only the location differs', async () => {
    // The detector's negative half. If `updateClub` accepted everything, the
    // test above would pass for the wrong reason — it would prove the action
    // does no validation at all rather than that it uses the edit schema.
    //
    // An EMPTY name rather than an absent one: both actions read
    // `formData.get('name')` raw, so an absent field reaches Zod as `null` and
    // answers its own type prose. Unreachable from either form — both always
    // render the input — and out of this change's scope, but it is why this
    // case is written with `name: ''`.
    const blank = { name: '', description: '', ...pick }
    const nameless = await updateClub('club-1', emptyActionState, form(blank))
    expect(nameless.error).toBe('Give your club a name.')
    const namelessCreate = await createClub(emptyActionState, form(blank))
    expect(namelessCreate.error).toBe('Give your club a name.')
  })
})
