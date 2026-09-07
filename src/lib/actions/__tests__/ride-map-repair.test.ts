import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyActionState } from '@/lib/actions/state'

/**
 * `updateRide` asks for a map again when a ride's render already failed — PD-385.
 *
 * **The defect this pins is an absence, which is why it needs a test at all.**
 * `requestRideMapRender` fires at create and on a location change, and nowhere
 * else. A ride whose render failed therefore had no route back: re-saving the
 * same address did nothing, because `addressChanged` compares the strings, so
 * the only repair was editing the meeting point into something genuinely
 * different. Measured on DEV 2026-09-07, 9 rides sat in exactly that state — 5
 * of them from the ten days `resolve-ride-location` was deployed with an
 * uppercase-hex marker the tile vendor answers 400 to.
 *
 * Nothing else in the suite can see this. The RLS suite cannot reach an Edge
 * Function, `tsc` does not compile one, and the walk asks whether a screen
 * rendered rather than whether a tile was requested for it.
 *
 * **Each case below pins one half of a two-sided rule**, because both directions
 * cost real money in opposite ways: not retrying leaves a ride permanently
 * blind, and retrying too widely spends a geocode and two tile renders on every
 * save of every ride. The negative cases are the ones a later "simplification"
 * breaks first.
 */

const from = vi.fn()
const getUser = vi.fn()
const invoke = vi.fn()
const remove = vi.fn()

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({
    from: (...args: unknown[]) => from(...args),
    rpc: vi.fn(),
    auth: { getUser },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    storage: { from: () => ({ remove: (...args: unknown[]) => remove(...args) }) },
  }),
}))

vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query')>()),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/analytics/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics/client')>()),
  capture: vi.fn(),
}))

import { updateRide } from '@/lib/actions/rides'

const USER = { id: '22222222-2222-4222-8222-222222222222' }
const RIDE_ID = '11111111-1111-4111-8111-111111111111'
const CARD = `ride-maps/${USER.id}/44444444-4444-4444-8444-444444444444.jpg`
const DETAIL = `ride-maps/${USER.id}/55555555-5555-4555-8555-555555555555.jpg`

type Result = { data: unknown; error: null | { code?: string; message?: string } }

/** The same recording builder shape `ride-audience.test.ts` uses. */
function chain(result: Result) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const builder: Record<string, unknown> = {}
  for (const method of [
    'select', 'insert', 'upsert', 'update', 'delete',
    'eq', 'in', 'order', 'limit', 'maybeSingle', 'single',
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.then = (resolve: (value: Result) => void) => resolve(result)
  return { builder, calls }
}

/**
 * A payload that changes the TITLE and nothing about the location. Every
 * location trigger — `addressChanged`, `pickCleared`, `pickChanged` — is false
 * against every fixture below, so a render asked for here was asked for by the
 * repair branch and by nothing else. That is the whole isolation this file
 * rests on: a fixture whose meeting point drifted from this string would pass
 * for the wrong reason.
 */
function payload(): FormData {
  const data = new FormData()
  data.append('title', 'Sunday run, renamed')
  data.append('meeting_point', 'Dam Square, Amsterdam')
  data.append('route_description', '')
  data.append('departure_at', '2027-05-01T09:00')
  data.append('club_id', '')
  data.append('is_public', 'on')
  return data
}

/** Answers the `previous` read with `stored`, and the UPDATE that follows with a row. */
function withStoredShape(stored: Record<string, unknown>) {
  let call = 0
  from.mockImplementation(() => {
    call += 1
    return chain({ data: call === 1 ? stored : { id: RIDE_ID }, error: null }).builder
  })
}

const stored = (over: Record<string, unknown> = {}) => ({
  meeting_point: 'Dam Square, Amsterdam',
  start_place_id: null,
  map_card_path: null,
  map_detail_path: null,
  latitude: null,
  timezone: 'Europe/Amsterdam',
  club_id: null,
  is_public: true,
  ...over,
})

const rendered = () =>
  invoke.mock.calls.filter(([slug]) => slug === 'resolve-ride-location').length

beforeEach(() => {
  from.mockReset()
  getUser.mockReset()
  invoke.mockReset()
  remove.mockReset()
  getUser.mockResolvedValue({ data: { user: USER } })
  invoke.mockResolvedValue({ data: { rendered: true } })
  remove.mockResolvedValue({ error: null })
})

describe('a failed render gets asked for again', () => {
  it('re-requests when the ride has a coordinate and neither tile', async () => {
    // The PD-385 population exactly, and the query that counted it:
    //   select … from rides where latitude is not null and map_card_path is null
    withStoredShape(stored({ latitude: 52.3731162 }))

    await updateRide(RIDE_ID, emptyActionState, payload())

    expect(rendered()).toBe(1)
  })

  it('re-requests when only ONE tile landed', async () => {
    // `051`'s `rides_map_paths_need_a_coordinate` permits this state in as many
    // words — "it also permits one path present and the other NULL" — and the
    // both-or-neither rule arrived later, in the function (PD-202). So a row
    // predating it can carry a card tile with no detail tile, which is the
    // licence problem PD-202 exists to prevent: vendor imagery on every
    // `RideCard` with the mandatory credit rendering nowhere.
    //
    // A condition testing `map_card_path` alone leaves this row unrepaired for
    // ever, and it is the natural condition to write, because it is the one the
    // issue's own counting query uses.
    withStoredShape(stored({ latitude: 52.3731162, map_card_path: CARD }))

    await updateRide(RIDE_ID, emptyActionState, payload())

    expect(rendered()).toBe(1)
  })

  it('does NOT sweep the surviving object, and that is the point of the separate arm', async () => {
    // **The tempting simplification is to fold this into the location-change
    // block, and it deletes a live tile.** There, `clear_ride_map_tiles` has
    // already NULLed both columns, so the objects are unreachable and the sweep
    // is the only thing that collects them. Here nothing has NULLed anything:
    // the row still names its surviving tile, that tile is on screen, and the
    // re-render is fire-and-forget — so a sweep followed by a render that does
    // not store (`render_ceiling`, a vendor blip, `nothing_to_write`) leaves the
    // columns pointing at deleted objects, permanently.
    //
    // `resolve-ride-location`'s own step 8 deletes the superseded pair only
    // `bothStored ? … : []`. This action cannot make that test, so it must not
    // delete. The accepted cost is one orphan in the half state; the cost of the
    // other choice is a rider losing a tile they already had.
    withStoredShape(stored({ latitude: 52.3731162, map_card_path: CARD }))

    await updateRide(RIDE_ID, emptyActionState, payload())

    expect(remove).not.toHaveBeenCalled()
    expect(rendered()).toBe(1)
  })
})

describe('what must NOT spend a render', () => {
  it('leaves a fully rendered ride alone when nothing about the location moved', async () => {
    // The common case by a wide margin. Every save of every ride would
    // otherwise cost a geocode and two tile renders at the vendor's meter.
    withStoredShape(
      stored({ latitude: 52.3731162, map_card_path: CARD, map_detail_path: DETAIL }),
    )

    await updateRide(RIDE_ID, emptyActionState, payload())

    expect(rendered()).toBe(0)
    expect(remove).not.toHaveBeenCalled()
  })

  it('leaves a ride with NO coordinate alone', async () => {
    // A coordinate is what tells "the render failed" from "we correctly
    // declined to draw". Every declining branch in `resolve-ride-location` —
    // a blank meeting point, `geocode_unavailable`, the granularity gate that
    // refuses a vague address — returns `noTile` BEFORE the coordinate is
    // written. So a ride the gates have already judged keeps a NULL latitude,
    // and retrying it would re-run a geocode that has already answered, on
    // every save, for ever.
    withStoredShape(stored())

    await updateRide(RIDE_ID, emptyActionState, payload())

    expect(rendered()).toBe(0)
  })

  it('leaves it alone when the coordinate column is absent from the read', async () => {
    // The fail-closed direction, and the reason the check is
    // `typeof … === 'number'` rather than `!== null`. A `latitude` dropped from
    // the select reads `undefined`, which passes `!== null` — so the loose test
    // would make every ride look like a failed render and turn every save into
    // a render pair, silently. A missing column must stop the repair, never
    // universalise it.
    const withoutLatitude = Object.fromEntries(
      Object.entries(stored()).filter(([column]) => column !== 'latitude'),
    )
    withStoredShape(withoutLatitude)

    await updateRide(RIDE_ID, emptyActionState, payload())

    expect(rendered()).toBe(0)
  })
})

describe('the read the repair depends on', () => {
  it('selects latitude alongside both path columns', async () => {
    // If any of the three falls off that select the repair stops working, and
    // the two directions fail differently: no `latitude` fails closed (above),
    // while a missing path column reads `undefined`, never `=== null`, and the
    // ride is never repaired at all. Neither failure has a visible symptom.
    const { builder, calls } = chain({
      data: stored({ latitude: 52.3731162 }),
      error: null,
    })
    from.mockReturnValue(builder)

    await updateRide(RIDE_ID, emptyActionState, payload())

    const selected = String(calls.find((c) => c.method === 'select')?.args[0])
    expect(selected).toContain('latitude')
    expect(selected).toContain('map_card_path')
    expect(selected).toContain('map_detail_path')
  })
})
