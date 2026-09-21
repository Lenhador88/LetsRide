import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `setRiderTown` — the one-column writer behind PD-419's town question and the
 * profile setting's `Remove`.
 *
 * **This file exists because the pre-merge review found that `Remove` could
 * never work, and nothing anywhere would have said so.**
 * `locationSchema` is `optionalText(…)`, a **`ZodString`** pipeline, so its
 * string type gate runs before the `'' -> null` transform and
 * `safeParse(null)` fails with `"Invalid input: expected string, received
 * null"` — the raw Zod message, rendered at a rider who tapped `Remove`, for
 * ever, with `profiles.location` unchanged.
 *
 * **Why every other gate agreed it was fine**, which is the reusable part:
 * `safeParse` takes `unknown`, so `string | null` type-checks cleanly and
 * `tsc` cannot see it; the suite had no test for this action; the walk visits
 * no `/profile` location control; and clearing is the one path a rider only
 * reaches after they have already set a town. A green `tsc`, 3433 green tests,
 * a green build and a green walk were all true at once.
 *
 * **Clearing is not a nice-to-have here.** PD-419's DECIDED comment
 * (2026-09-06) requires that *no position at all* is a supported state and that
 * *clearing back to none works* — so this is the story's own obligation rather
 * than an edge case, and it is asserted first.
 */

const calls: Array<Record<string, unknown>> = []
const maybeSingle = vi.fn()
const update = vi.fn((values: Record<string, unknown>) => {
  calls.push(values)
  return { eq: () => ({ select: () => ({ maybeSingle }) }) }
})

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({
    from: () => ({ update }),
    auth: { getUser: async () => ({ data: { user: { id: 'rider-1' } } }) },
  }),
}))

const clearRiderLocation = vi.fn()
vi.mock('@/lib/location/rider-location', () => ({
  clearRiderLocation: () => clearRiderLocation(),
}))

const invalidate = vi.fn()
vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query')>()),
  invalidate: (...args: unknown[]) => invalidate(...args),
}))

import { setRiderTown } from '@/lib/actions/profile'

beforeEach(() => {
  calls.length = 0
  update.mockClear()
  invalidate.mockClear()
  clearRiderLocation.mockClear()
  maybeSingle.mockResolvedValue({ data: { id: 'rider-1' }, error: null })
})

describe('clearing back to none — the obligation PD-419 names', () => {
  it('writes SQL NULL for an explicit clear, rather than refusing it', () => {
    // THE assertion of this file. Before the fix this returned
    // `{ error: 'Invalid input: expected string, received null' }` and issued
    // no write at all.
    return setRiderTown(null).then((result) => {
      expect(result.error).toBeNull()
      expect(calls).toEqual([{ location: null }])
    })
  })

  it('writes SQL NULL rather than the empty string for a blank town', async () => {
    // The schema's own `'' -> null` transform. A stored `''` would make
    // `getMyLocationText` answer truthy-empty and read as a town nobody typed.
    await setRiderTown('')
    await setRiderTown('   ')
    expect(calls).toEqual([{ location: null }, { location: null }])
  })
})

describe('an ordinary pick', () => {
  it('stores the picked name', async () => {
    const result = await setRiderTown('Utrecht')
    expect(result.error).toBeNull()
    expect(calls).toEqual([{ location: 'Utrecht' }])
  })

  it('refuses a town longer than the column accepts, before writing anything', async () => {
    // `018`'s CHECK is the guarantee; this is the message. A picker that could
    // return a value its own CHECK refuses is a dead end the rider cannot
    // escape, since the field owns the value.
    const result = await setRiderTown('x'.repeat(101))
    expect(result.error).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('the memo and the cache are BOTH swept, and neither substitutes', () => {
  it.each([
    ['a set', 'Utrecht' as string | null],
    ['a clear', null as string | null],
  ])('sweeps the module memo on %s', async (_label, town) => {
    await setRiderTown(town)

    // `resolveRiderLocation` memoises its resolved chain for
    // `GEOLOCATION_MAX_AGE_MS`. Invalidating the query keys alone hands the
    // refetch the cached promise built from the town just replaced — so the
    // screens would keep measuring from the old one for up to five minutes.
    expect(clearRiderLocation).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('sweeps nothing when the write failed', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'nope' } })

    const result = await setRiderTown('Utrecht')

    expect(result.error).toBeTruthy()
    expect(clearRiderLocation).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('the country that came off the same pick — PD-445', () => {
  it('writes it beside the town when the pick carried one', async () => {
    const result = await setRiderTown('Hoorn', 'NL')
    expect(result.error).toBeNull()
    expect(calls).toEqual([{ location: 'Hoorn', home_country: 'NL' }])
  })

  it('uppercases it, because `113`’s CHECK is `^[A-Z]{2}$`', async () => {
    // The vendor's casing is not this app's to trust: `asCountryCode`
    // uppercases in `search-places/shape.ts`, and doing it here too means a
    // seeded or hand-built `PlaceValue` cannot reach the column as `nl` and
    // come back as a raw 23514 in front of a rider.
    await setRiderTown('Hoorn', 'nl')
    expect(calls[0].home_country).toBe('NL')
  })

  it('OMITS the key entirely when the pick carried no country', async () => {
    // **The absence of the key, not a null value**, and the difference is the
    // whole point. `113`'s trigger coerces a NULL back to the stored country —
    // but only `if old.home_country is not null`, so the arm is dead for every
    // rider who has none, which is currently all of them (0 of 25 on DEV, 0 of
    // 5 on PROD). And the trigger's first statement is
    // `if current_user <> 'authenticated' then return new`, so it is a rule
    // about what a client may write rather than about the column. Writing NULL
    // and trusting the coercion would be trusting a branch that does not run.
    await setRiderTown('Hoorn')
    expect(calls[0]).not.toHaveProperty('home_country')
    expect(calls[0]).toEqual({ location: 'Hoorn' })
  })

  it('OMITS the key for an explicitly null country', async () => {
    // `PlaceValue.countryCode` is `string | null | undefined` — seeded values
    // omit the property, a fresh lookup can answer null. Both mean "no
    // country" and must reach the column the same way.
    await setRiderTown('Hoorn', null)
    expect(calls[0]).not.toHaveProperty('home_country')
  })

  it('OMITS the key for an empty or whitespace country', async () => {
    await setRiderTown('Hoorn', '   ')
    expect(calls[0]).not.toHaveProperty('home_country')
  })

  it('never writes a country on a CLEAR', async () => {
    // Removing your town is not withdrawing the country it came from, and
    // `LocationSetting`'s Remove is an obligation PD-419 names in as many
    // words. A country arriving here alongside a null town is a caller bug;
    // this pins that it cannot reach the column either way.
    await setRiderTown(null, 'NL')
    expect(calls).toEqual([{ location: null }])
  })

  it('still clears when Remove is tapped, with no country argument at all', async () => {
    // `LocationSetting.clear()` passes one argument. The second being optional
    // is what keeps that call site untouched, and this is the assertion that
    // says the signature change did not break it.
    const result = await setRiderTown(null)
    expect(result.error).toBeNull()
    expect(calls).toEqual([{ location: null }])
  })
})
