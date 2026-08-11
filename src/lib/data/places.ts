import { resolveSupabase } from '@/lib/supabase/resolve'
import { unwrapList } from '@/lib/data/unwrap'
import type { LocalityCentroid, PlaceSearchResult } from '@/types'

/**
 * `search_places(q, near_lat, near_lon)` (`037`/`039`) — the meeting-point
 * typeahead. Read `PlaceSearchResult`'s own doc block in `src/types/index.ts`
 * before touching this file; it carries the contracts this module exists to
 * honour (ranking, the per-token AND, the proximity bias's sharp edge) rather
 * than restating them here.
 */

/**
 * Below this, `searchPlaces` returns `[]` without a round trip at all.
 *
 * **Stricter than the database's own floor, and deliberately a different kind
 * of rule.** `search_places()` refuses below three consecutive alphanumerics
 * — `term ~ '[[:alnum:]]{3}'` — which is a *security* floor: it keeps a query
 * off a sequential scan, and it refuses by returning zero rows rather than by
 * "no matches". Four is layered on top of that, and it exists for a different
 * reason entirely: performance and UX, not safety. Measured (`PlaceSearchResult`'s
 * doc block): the national pass costs **996 ms for `sta`** — three characters,
 * so it is the *first* query a typeahead fires the instant the guard stops
 * refusing, for anyone typing "Stationsweg". Four characters is not a magic
 * number the database would also accept faster; it is this client choosing not
 * to fire the worst common case at all. Keep both floors — collapsing them into
 * one would either loosen the security guard or block a legitimate two-token
 * query like `Kerkstraat 40` for a UX reason that has nothing to do with it.
 * (`ab 40` is not that example — it is refused by the database's own guard
 * regardless of anything this file does, since it holds no run of three
 * consecutive alphanumerics anywhere in the term.)
 */
export const PLACE_SEARCH_MIN_CHARS = 4

/**
 * `PlaceSearchResult`'s doc block again: "Refuse or truncate terms beyond a
 * handful of tokens client-side... nothing collapses genuinely distinct
 * substrings and a function-level `statement_timeout` cannot bound it" — ten
 * substrings of one 49-character word measured 5,914 ms on the synthetic
 * bench, because they AND to the same rows while multiplying the per-row work
 * tenfold. This is **not optional** per that comment, and there is no other
 * client-side caller yet for it to live in.
 *
 * Eight tokens covers any real meeting-point query with room to spare
 * ("Jumbo Maastricht Stationsweg 40" is four), and truncating rather than
 * refusing means a rider who pastes something long still gets a search back.
 *
 * **Truncating makes the search BROADER, not narrower** — tokens are ANDed, so
 * dropping one removes a constraint and more rows match. That is the safe
 * direction (never a missed match, though the five-row cap can still rank one
 * out — see `search_places()`'s own `limit 5`) but it is the opposite of what
 * it intuitively reads as, and an earlier revision of this comment had it
 * backwards.
 *
 * **This is not the security bound and never was — `049` is.** A client-side
 * cap only reaches riders using our UI; anyone can call the RPC directly
 * through PostgREST with forty tokens and pay none of it, which is why PD-150
 * stayed open until the refusal landed in `search_places()` itself.
 *
 * **The two numbers must stay equal, and `__tests__/places.test.ts` asserts it
 * against the migration file rather than trusting this comment.** `049` refuses
 * above eight distinct tokens; this truncates to eight. Because the database
 * dedups the same eight again with `lower()`, which can only reduce the count,
 * a term from this file can never be refused there. Lower this number and
 * riders simply search on fewer words; lower the DATABASE's below this one and
 * every long query silently returns zero rows, which is the dead zone the pair
 * exists to prevent.
 */
export const PLACE_SEARCH_MAX_TOKENS = 8

/**
 * Deduped case-insensitively before the cap is applied — not a query-cost fix
 * (`039` §5d already dedups server-side before building patterns, so a
 * repeated word costs one pattern there regardless of what this does), but
 * without it here the CAP wastes its budget on repeats: `Jumbo jumbo JUMBO
 * ×8 Maastricht` is nine raw tokens, so the un-deduped cap kept the eight
 * Jumbos and dropped `Maastricht` entirely — where the database would have
 * collapsed the eight into one and kept it. Deduping first means a repeated
 * word can never push a genuinely distinct one out of the truncated term.
 */
function boundTerm(term: string): string {
  const tokens = term.split(/\s+/).filter(Boolean)

  const deduped: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const key = token.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(token)
    }
  }

  return deduped.length > PLACE_SEARCH_MAX_TOKENS
    ? deduped.slice(0, PLACE_SEARCH_MAX_TOKENS).join(' ')
    : term
}

/** What `resolveRiderLocation()` (`src/lib/location/`) hands to `searchPlaces`
 * as a proximity bias. Structural rather than imported from there, so this
 * file does not have to depend on the location resolver to describe its own
 * parameter. */
export type PlaceSearchBias = { lat: number; lon: number }

/**
 * The typeahead read. `near` is optional — pass it whenever
 * `resolveRiderLocation()` has an answer, because the difference is not
 * cosmetic: measured **17–152 ms with coordinates** against **171–2,957 ms
 * without**, since only the biased path gets the bbox. Omitting it still
 * works and ranks on text alone.
 *
 * `signal` is threaded straight to the RPC's own `abortSignal`, for a caller
 * that debounces and cancels a stale request. A cancellation is not a data
 * failure — `unwrap`'s honesty argument is about a query that actually broke,
 * not about a rider who kept typing — so it is rethrown as a plain
 * `AbortError` rather than wrapped in `DataReadError`, and a caller that does
 * not pass a signal never sees this branch at all.
 */
export async function searchPlaces(
  term: string,
  near: PlaceSearchBias | null,
  signal?: AbortSignal
): Promise<PlaceSearchResult[]> {
  const trimmed = term.trim()
  if (trimmed.length < PLACE_SEARCH_MIN_CHARS) return []

  const supabase = await resolveSupabase()
  let query = supabase.rpc('search_places', {
    q: boundTerm(trimmed),
    near_lat: near?.lat ?? null,
    near_lon: near?.lon ?? null,
  })
  if (signal) query = query.abortSignal(signal)

  const result = await query

  if (result.error && signal?.aborted) {
    const aborted = new Error('The place search was cancelled.')
    aborted.name = 'AbortError'
    throw aborted
  }

  return unwrapList(result, 'places matching that search') as unknown as PlaceSearchResult[]
}

/**
 * `locality_centroid(q)` (`040`). Resolves a rider's free-text onboarding
 * `location` (`profiles.location`) to a coarse centroid, for
 * `resolveRiderLocation`'s profile fallback (`src/lib/location/`).
 *
 * **Degrades to `null` on ANY error, not only "function missing" — a
 * deliberate departure from `unwrap`'s throw-on-error rule.** Every other read
 * in this directory throws, because a swallowed failure there is a screen
 * quietly rendering the wrong thing. This one is different in kind: it feeds a
 * search *bias*, not correctness-critical data, and `search_places` already
 * treats "no location" as a first-class case — the worst outcome of treating a
 * real failure as "no bias" is an unbiased nationwide search.
 *
 * **This is not a temporary shim for `040` being unshipped, and it must not
 * be read that way once that migration has landed.** It stays permanent: the
 * function can still be renamed, dropped, or refused by a role grant that
 * changes independently of this file, and swallowing that silently forever
 * is a worse failure than the one it prevents — hence the `console.warn`,
 * which is what keeps a broken deploy from being invisible.
 *
 * `LocalityCentroid`'s own doc block promises every field is genuinely
 * non-nullable and that emptiness is expressed as zero rows, never a row of
 * nulls (the function's `having count(*) > 0`) — so this trusts that contract
 * for `place_count` rather than re-deriving it, and only sanity-checks the
 * two fields it is about to feed into a search RPC.
 */
export async function getLocalityCentroid(q: string): Promise<LocalityCentroid | null> {
  const trimmed = q.trim()
  if (!trimmed) return null

  const supabase = await resolveSupabase()
  const { data, error } = await supabase.rpc('locality_centroid', { q: trimmed })
  if (error) {
    console.warn('[places] locality_centroid failed — searching with no location bias', error)
    return null
  }

  const row = ((data ?? []) as LocalityCentroid[])[0]
  if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) return null

  return row
}
