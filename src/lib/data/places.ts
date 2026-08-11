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
 * **What this guarantees is a property of the OUTPUT, not a prediction about
 * how Postgres will read the input** — see `boundTerm` below for why the
 * predicting version was wrong twice over.
 */
export const PLACE_SEARCH_MAX_TOKENS = 8

/**
 * Normalises the term to **at most eight tokens joined by single U+0020**, and
 * does so UNCONDITIONALLY rather than only when it truncates.
 *
 * **The unconditional part is the whole correctness argument, and the earlier
 * version — which returned the raw term whenever it was under the cap — was
 * wrong in two independent ways.** That version tried to *predict* how Postgres
 * would tokenise the rider's string. Both runtimes disagree about Unicode, in
 * the same harmful direction, and both were measured against DEV rather than
 * reasoned about:
 *
 *  - **The split.** `U+001C`–`U+001F` and `U+0085` are token separators to
 *    Postgres's `\s` and are *not* matched by JavaScript's. So
 *    `"aabb cc dd ee ff gg hh ii"` counted 8 here, passed through
 *    untouched, and reached the database as **9** — refused, zero rows, and a
 *    caller cannot tell that from an honest miss.
 *  - **The fold.** The database's `lower()` is ICU's, not V8's. There are 55
 *    code points V8 lowercases and this server's ICU does not — `U+1C89`,
 *    seven more in the BMP, and 47 across Garay and Medefaidrin — so
 *    `"Ᲊx ᲊx abc def ghi jkl mno pqr stu"` deduped to 8 here and to **9**
 *    there. **That set is a function of the server's ICU version and regrows
 *    with every Unicode release**, so it cannot be enumerated once and pinned.
 *
 * Splitting on a class that is a superset of any plausible server's whitespace
 * and then rejoining with a plain space means the database receives a string
 * containing no character any locale could split on. Postgres's split is
 * therefore *this* split, and its `lower()` can then only ever merge — so
 * eight stays at most eight whatever ICU the server runs. **The proof stops
 * depending on the two runtimes agreeing about Unicode.**
 *
 * `\p{Cc}` is what carries `U+0085` and the C0 separators; `\p{Zs}` is already
 * inside `\s` and is named for intent. `\p{Cf}` is deliberately absent — the
 * database does *not* split on `U+200B`/`U+FEFF`/`U+00AD`/`U+2060` (measured),
 * and stripping format characters would corrupt legitimate text, ZWJ sequences
 * most obviously.
 *
 * **Two behaviour notes, both in the safe direction:**
 *
 *  - The term is no longer sent verbatim. A character this splits on but the
 *    database would not (`U+FEFF`, `U+00A0`) becomes a space, so the search
 *    WIDENS — tokens are ANDed, so a separator that was previously part of a
 *    token now imposes two weaker constraints instead of one stronger one.
 *    Never a missed match, though the five-row cap can still rank one out.
 *  - Case-insensitive dedup runs before the slice, so a repeated word cannot
 *    push a genuinely distinct one out of the truncated term: `Jumbo jumbo
 *    JUMBO ×8 Maastricht` keeps `Maastricht`. It now also *reaches* the
 *    database deduped rather than raw, which only improves the
 *    `similarity(term, name)` ranking the repeats were diluting.
 */
function boundTerm(term: string): string {
  const tokens = term.split(/[\s\p{Zs}\p{Cc}]+/u).filter(Boolean)

  const deduped: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const key = token.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(token)
    }
  }

  return deduped.slice(0, PLACE_SEARCH_MAX_TOKENS).join(' ')
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
