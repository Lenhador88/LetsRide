import { resolveSupabase } from '@/lib/supabase/resolve'
import { edgeFunctionErrorCode } from '@/lib/supabase/functions'
import type { LocalityCentroid, PlaceSearchResult } from '@/types'

/**
 * `search-places` (`supabase/functions/search-places/`, PD-273) — the meeting-
 * point typeahead and the profile-locality resolver, both proxied through one
 * Edge Function so the vendor key and hostname never reach the bundle.
 *
 * **Replaces `search_places()`/`locality_centroid()` (`037`–`050`), which `070`
 * drops.** Read `PlaceSearchResult`'s own doc block in `src/types/index.ts`
 * before touching this file; it carries the contract this module exists to
 * honour rather than restating it here. That contract did not change —
 * `{id, label, meta, lat, lon}` — only where it is answered from.
 */

/**
 * Below this, `searchPlaces` returns `[]` without a round trip at all.
 *
 * **The reason changed, and the number did not.** This used to be a
 * performance/UX floor layered on top of the database's own *security* floor
 * (three consecutive alphanumerics, refused rather than "no matches") — the
 * national pass measured 996 ms for `sta`, so this client chose not to fire the
 * worst common case. There is no query planner any more; the cost is a credit
 * against a shared daily vendor quota, which is a stronger argument for the
 * same number rather than a reason to revisit it. `search-places/shape.ts`
 * carries its own copy, `MIN_TERM_CHARS` — that one BINDS, because a caller can
 * reach the function without going through this client at all, and this one is
 * only the optimisation that keeps a short term from costing a round trip.
 */
export const PLACE_SEARCH_MIN_CHARS = 4

/**
 * The upper bound this client will SEND, in characters. A pasted essay is
 * bounded before it goes anywhere — `place-search`'s own requirement, because a
 * client-side bound only reaches riders using this UI and the proxy has to bound
 * it again regardless (`search-places/shape.ts`'s `MAX_TERM_CHARS`, which this
 * mirrors). Not enforced here as a truncation: the sheet's `<input maxLength>`
 * is where a rider's paste is actually cut, natively, before it ever reaches
 * this function — this constant is what that prop is set from, so the two
 * cannot drift apart.
 */
export const PLACE_SEARCH_MAX_CHARS = 200

/**
 * How long a search-result cache entry stays fresh before a retyped term costs
 * a credit again — `keys.places.search`'s lifetime, stated here beside the
 * function that reads it rather than only in `keys.ts`'s comment, per
 * `client-cache-invalidation`'s "stated beside the key with the reason it is
 * that number".
 *
 * **A place does not move; a rider's typing does.** Five minutes is long
 * enough to survive the ordinary reason a term gets re-searched — backspacing
 * to fix a typo and retyping within the same sheet visit — and short enough
 * that a rider who leaves the sheet open for an hour does not read a
 * meaningfully stale answer. Matches `GEOLOCATION_MAX_AGE_MS` in
 * `src/lib/location/rider-location.ts` for the same order-of-magnitude
 * reasoning: "a resolved answer is not worth trusting past it," applied to a
 * search result instead of a position fix.
 */
export const PLACE_SEARCH_CACHE_MS = 5 * 60_000

/**
 * Thrown by `searchPlaces` for one of the rider's own ceilings — `069`'s
 * hourly and daily conjuncts on `place_search_attempts`' INSERT policy.
 *
 * **`scope` is INFERRED client-side, not told by the server, and that is a
 * deliberate proxy limitation rather than an oversight here.** The proxy's
 * `429 {error: 'ceiling'}` cannot distinguish which of the three conjuncts in
 * `069`'s policy refused — Postgres does not report which arm of a multi-arm
 * `WITH CHECK` failed, and `design.md` §D9 is explicit that the function "does
 * not get to know which bound, and must not guess." So this class's `scope` is
 * this MODULE's best guess, built from how many searches this browser tab has
 * itself completed in the last hour versus the last day — see
 * `recordAttempt`/`inferCeilingScope` below. It can be wrong (a rider who
 * exhausted their ceiling on a different tab or device shows as `'daily'` here
 * with no local evidence either way), and the safe default is `'daily'`
 * precisely because telling a rider who is done for the day to "try again
 * shortly" is the worse of the two wrong answers — `place-search`'s spec names
 * that exact failure mode.
 *
 * `'forbidden'` (the participation gate — an un-onboarded or anonymous
 * account, unreachable through the guarded UI) throws this too, per the
 * spec's "the proxy SHALL return the same exhausted-or-refused outcome it
 * returns for a ceiling ... the rider SHALL NOT be told which gate refused
 * them."
 */
export class PlaceSearchCeilingError extends Error {
  readonly scope: 'hourly' | 'daily'

  constructor(scope: 'hourly' | 'daily') {
    super(
      scope === 'hourly'
        ? "You've searched a lot in the last hour. Try again shortly, or type the location in."
        : "You've searched a lot today. Search resumes tomorrow — or type the location in."
    )
    this.name = 'PlaceSearchCeilingError'
    this.scope = scope
  }
}

/**
 * Thrown for every failure that is not the rider's own doing — a vendor or
 * ledger outage, a bad or missing session, a network failure that never
 * reached the function, or the application-wide ceiling (`069`'s third
 * conjunct). `place-search`'s spec is explicit that the app-wide ceiling
 * SHALL be presented this way rather than as the rider's own ceiling: "it is
 * not the rider's fault and there is nothing about their own behaviour they
 * can change."
 */
export class PlaceSearchUnavailableError extends Error {
  constructor() {
    super('Search could not be reached. Try again, or type the location in.')
    this.name = 'PlaceSearchUnavailableError'
  }
}

/** Thrown when the device itself has no connection — checked before the
 *  function is even called, so an offline rider is told that rather than
 *  shown a generic failure a beat later when the fetch itself rejects. */
export class PlaceSearchOfflineError extends Error {
  constructor() {
    super('This device has no connection. Reconnect, or type the location in.')
    this.name = 'PlaceSearchOfflineError'
  }
}

/**
 * How many of THIS browser tab's own place searches completed in the last
 * hour and in the last 24 hours — the local evidence `PlaceSearchCeilingError`
 * infers `scope` from. Holds timestamps only, exactly like the ledger it is
 * shadowing (`069`'s own table carries a rider id and a timestamp and nothing
 * else); nothing here is a search term.
 *
 * Module-level rather than in the query cache: this is a heuristic counter,
 * not cached data a screen renders, and it must survive a client-side
 * navigation the same way `rider-location.ts`'s memo does.
 */
let recentAttempts: number[] = []

const CEILING_SCOPE_WINDOW_MS = {
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
} as const

/** Called after every request that the ledger actually accepted — a result
 *  set, an empty one, or an `'unavailable'` vendor outage all mean the INSERT
 *  succeeded, because `069`'s ledger row is written BEFORE the vendor is
 *  called. A `'ceiling'` or `'forbidden'` refusal must NOT call this: no row
 *  was written, so it must not inflate the very count `inferCeilingScope`
 *  reads. */
function recordAttempt(): void {
  const now = Date.now()
  recentAttempts.push(now)
  const floor = now - CEILING_SCOPE_WINDOW_MS.daily
  recentAttempts = recentAttempts.filter((t) => t > floor)
}

/**
 * See `PlaceSearchCeilingError`'s own doc block for why this is a guess.
 * Mirrors `069`'s two per-rider ceilings — `PER_RIDER_HOURLY = 20`,
 * `PER_RIDER_DAILY = 60`, `search-places/shape.ts` — as the thresholds this
 * tab's own local count is compared against. Defaults to `'daily'` when
 * neither threshold is locally evidenced, which is the safer of the two wrong
 * answers per this class's own doc block.
 */
function inferCeilingScope(): 'hourly' | 'daily' {
  const now = Date.now()
  const hourly = recentAttempts.filter((t) => t > now - CEILING_SCOPE_WINDOW_MS.hourly).length
  // 'daily' is the fallback whether the local daily count also clears 60 or
  // there simply is no local evidence — both read the same to a rider who
  // was refused with nothing in this tab's own history.
  return hourly >= 20 ? 'hourly' : 'daily'
}

/** Sign-out's own sweep, matching `clearRiderLocation` in
 *  `src/lib/location/rider-location.ts` — a heuristic built from rider A's
 *  searches must not shape the ceiling message rider B sees on the same
 *  device. Holds no term and no address, so this is tidiness rather than a
 *  privacy fix in its own right. */
export function resetPlaceSearchCeilingHeuristic(): void {
  recentAttempts = []
}

/**
 * The typeahead read. `near` is optional — pass it whenever
 * `resolveRiderLocation()` has an answer; the proxy biases toward it rather
 * than filtering by it (`design.md` §D8), so omitting it only costs relevance,
 * never a missed match.
 *
 * `signal` is threaded to `functions.invoke`'s own `abortSignal`, for a caller
 * that debounces and cancels a stale request. A cancellation is not a data
 * failure — a rider who kept typing, not a broken query — so it is rethrown as
 * a plain `AbortError`, exactly as the RPC-backed version did, and a caller
 * that does not pass a signal never sees this branch at all.
 *
 * **Throws on every other failure, honestly** — `place-search`'s seven states
 * are represented as four distinct thrown shapes a caller can branch on by
 * `.name`, the same pattern `AbortError` already uses here: `AbortError`
 * (cancelled), `PlaceSearchOfflineError` (no connection),
 * `PlaceSearchCeilingError` (one of the rider's own ceilings, `.scope` says
 * which — see its own doc block for why that is inferred), and
 * `PlaceSearchUnavailableError` (everything else: a vendor or ledger outage,
 * the application-wide ceiling, an un-onboarded account, a bad session). A
 * caller that only wants rows or nothing can catch all four and fall back to
 * `[]`; `PlaceSearchField` renders each as its own message instead, per
 * `place-search`'s spec.
 */
export async function searchPlaces(
  term: string,
  near: { lat: number; lon: number } | null,
  signal?: AbortSignal
): Promise<PlaceSearchResult[]> {
  if (term.trim().length < PLACE_SEARCH_MIN_CHARS) return []

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new PlaceSearchOfflineError()
  }

  const supabase = await resolveSupabase()

  // `functions.invoke` never rejects — every failure, including an aborted
  // fetch, lands in `response.error` rather than a thrown exception (verified
  // against `@supabase/functions-js`'s own `invoke`, which wraps its whole
  // body in try/catch and returns `{data: null, error}`). So abort is
  // detected the same way the RPC-backed version detected it: an error
  // alongside an already-aborted signal, checked BEFORE anything tries to
  // classify the error as a ceiling or an outage.
  const response = await supabase.functions.invoke('search-places', {
    body: { mode: 'search', text: term.slice(0, PLACE_SEARCH_MAX_CHARS), near },
    signal,
  })

  if (response.error) {
    if (signal?.aborted) {
      const aborted = new Error('The place search was cancelled.')
      aborted.name = 'AbortError'
      throw aborted
    }
    const code = await edgeFunctionErrorCode(response.error)
    if (code === 'ceiling' || code === 'forbidden') {
      throw new PlaceSearchCeilingError(inferCeilingScope())
    }
    // 'unavailable' (a vendor or ledger outage) still wrote a ledger row —
    // `069`'s insert happens BEFORE the vendor is called — so it counts
    // toward the local heuristic exactly like a success. Only 'unauthorized'
    // (no session at all, unreachable through the guarded UI) and a network
    // failure that never reached the function did not.
    if (code === 'unavailable') recordAttempt()
    throw new PlaceSearchUnavailableError()
  }

  recordAttempt()

  const results = (response.data as { results?: unknown } | null)?.results
  return Array.isArray(results) ? (results as PlaceSearchResult[]) : []
}

/**
 * `getLocalityCentroid` reads the proxy's `locality` mode. Resolves a rider's
 * free-text onboarding `location` (`profiles.location`) to a coarse centroid,
 * for `resolveRiderLocation`'s profile fallback (`src/lib/location/`).
 *
 * **Degrades to `null` on ANY error, not only "function missing" — carried
 * over from the RPC-backed version deliberately, and the reason survives the
 * move unchanged.** This feeds a search BIAS, not correctness-critical data,
 * and the proxy already treats "no location" as a first-class case — the
 * worst outcome of treating a real failure as "no bias" is an unbiased
 * nationwide search, never a broken screen. This is also why it does NOT
 * throw the four typed errors `searchPlaces` does: nothing calls this
 * expecting to render a distinct message per failure, `resolveRiderLocation`
 * least of all.
 *
 * `LocalityCentroid` no longer carries `place_count` — the RPC's row count is
 * gone with the table that could count rows — so this returns `{lat, lon}`
 * exactly as the proxy answers it, sanity-checked the same way the RPC
 * version was: a malformed pair degrades to `null` rather than reaching a
 * caller as `NaN`.
 *
 * Metered under the SAME ledger as `searchPlaces` (`design.md` §D5), so a
 * successful call here also calls `recordAttempt()` — the hourly/daily local
 * counts `PlaceSearchCeilingError.scope` infers from must include locality
 * lookups or they under-count a rider who has been using both.
 */
export async function getLocalityCentroid(q: string): Promise<LocalityCentroid | null> {
  const trimmed = q.trim()
  if (!trimmed) return null

  const supabase = await resolveSupabase()

  // `functions.invoke` never rejects — see `searchPlaces`'s own comment.
  const response = await supabase.functions.invoke('search-places', {
    body: { mode: 'locality', text: trimmed.slice(0, PLACE_SEARCH_MAX_CHARS), near: null },
  })

  if (response.error) {
    const code = await edgeFunctionErrorCode(response.error)
    // Unlike searchPlaces this never throws, but the ledger's own accounting
    // still needs every accepted attempt — a 'ceiling'/'forbidden' refusal
    // wrote no row, so only count anything else as an attempt.
    if (code !== 'ceiling' && code !== 'forbidden') recordAttempt()
    console.warn('[places] search-places (locality) failed — searching with no location bias', response.error)
    return null
  }

  recordAttempt()

  const centroid = (response.data as { centroid?: { lat?: unknown; lon?: unknown } | null } | null)?.centroid
  if (!centroid) return null

  const { lat, lon } = centroid
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  return { lat, lon }
}
