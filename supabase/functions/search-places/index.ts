/**
 * search-places — proxies the place typeahead to the geocoding vendor, so the
 * key and the vendor hostname never reach a rider's device.
 *
 * ===========================================================================
 * NOT DEPLOYED. Read the state before assuming this runs.
 * ===========================================================================
 * New in PD-273. Deploying is an OWNER action — there is no `supabase` CLI in
 * the build container and `deploy_edge_function` is on `.claude/settings.json`'s
 * `deny` list — and it is **on the critical path**, unlike `delete-account`'s
 * and `resolve-ride-location`'s stale deploys, which are drift. Check rather
 * than trust this paragraph:
 *
 *   mcp__Supabase__list_edge_functions zwprydcyryvudhurbnye   # PROD
 *   mcp__Supabase__list_edge_functions fpmrimzxadewsaiwpsel   # DEV
 *
 * **Deploying this changes nothing on its own, deliberately.** Nothing calls it
 * until PR 2 switches `src/lib/data/places.ts`; until then the client still
 * reads `search_places()` and every rider-visible behaviour is unchanged. The
 * metering table it writes to does not exist until `069`, which is also PR 2 —
 * so a call made between this deploy and that migration fails closed at the
 * insert, before anything billable. That ordering is the design, not an
 * oversight: `design.md` §D7.
 *
 * Verify a deploy **by content**, never by a moved `ezbr_sha256` — a moved
 * digest proves a deploy happened, never which build (PD-249).
 *
 * ---------------------------------------------------------------------------
 * NOTHING TYPE-CHECKS THIS FILE
 * ---------------------------------------------------------------------------
 * `tsconfig.json` excludes `supabase/functions` because this is Deno. So
 * `npx tsc --noEmit` will not see a bug here, and neither will `next build`,
 * Vitest or the RLS suite. Every *decision* lives in `shape.ts` — no Deno
 * global, no `jsr:` import — so `src/__tests__/place-search-shape.test.ts` can
 * import it and `tsc` follows it in. **Keep the split.** ESLint parses this file
 * and is the only tool pointed at it; do not add the directory to the ignores.
 *
 * ---------------------------------------------------------------------------
 * The rules that make it safe, in order of how much they matter
 * ---------------------------------------------------------------------------
 * 1. **No service-role key.** The metering insert runs under the CALLER's
 *    forwarded JWT as `authenticated`, subject to exactly the policies the app
 *    is subject to. The property that matters is not that we were careful: it
 *    is that this function **cannot exceed its caller**, so the ceiling in
 *    `069`'s INSERT policy binds it as hard as it binds a rider calling
 *    PostgREST directly.
 * 2. **It takes no user id.** There is no field for one in `ProxyRequest`. The
 *    subject comes from the verified JWT and nowhere else — "we check the id
 *    matches the caller" is one refactor away from not doing that.
 * 3. **It verifies the JWT itself** rather than trusting the gateway, via the
 *    anon client's `getUser(token)`, which resolves the token against GoTrue.
 *    The publishable key is a valid JWT and sails straight past a decode-only
 *    check; against GoTrue it is not a user session and fails.
 * 4. **The vendor key lives only in this function's secret store.** Not in
 *    `src/`, `.env.local.example`, Vercel, a fixture or any `NEXT_PUBLIC_*`.
 *    `src/__tests__/no-geoapify-key.test.ts` is the tripwire and it covers this
 *    directory too.
 * 5. **The search term is never logged, never stored, never attributed.** See
 *    §The term below — it is the most sensitive free text this app handles.
 *
 * ---------------------------------------------------------------------------
 * Order of operations, and why each step is where it is
 * ---------------------------------------------------------------------------
 * Everything cheap and everything refusable happens before anything billable.
 *
 *   1. CORS preflight, then POST-only.                       — no spend
 *   2. Verify the token against GoTrue.                      — no spend
 *   3. Refuse an anonymous session.                          — no spend
 *   4. Parse; refuse a term below the floor.                 — no spend
 *   5. **Metering insert. Refused -> stop.**                 — no spend
 *   6. Call the vendor, then map.                            — BILLABLE
 *
 * **Step 5 is before step 6 and that ordering is the entire point of the
 * ledger** — the same argument `resolve-ride-location` makes for its own. It
 * counts *attempts*, not successes: a vendor call that times out or returns
 * nothing still spent a credit, so a counter that rose on a successful response
 * would miss precisely the rider retrying because nothing is coming back.
 *
 * **Step 5 is also the participation gate.** `069` hangs
 * `enforce_participation_gate` on the ledger, so an account created by calling
 * GoTrue's `/auth/v1/signup` directly and never accepting the terms cannot
 * spend a credit — no metering row, no vendor call. That closes for this
 * surface the hole CLAUDE.md documents against `profiles` UPDATE.
 *
 * ---------------------------------------------------------------------------
 * The term
 * ---------------------------------------------------------------------------
 * A search term here is frequently a home address — the rider's own, or the one
 * they are inviting a crew to. It is not written to the ledger, not to a log
 * line, not to an error report. Log lines carry an outcome and a reason code
 * and nothing else, following `resolve-ride-location`, which logs "no tile" and
 * a reason and never an address.
 *
 * The vendor necessarily receives it. That is the one disclosure this design
 * makes, and it receives no rider identity, session or IP with it, because the
 * request originates here rather than from the device. `/legal/privacy` says so.
 *
 * ---------------------------------------------------------------------------
 * A vendor 429 is an outage — §D9
 * ---------------------------------------------------------------------------
 * The vendor's 5 requests/second is a GLOBAL limit, not a per-rider one, so ten
 * riders typing at once can exceed it while every one is far below their own
 * ceiling. This function is multi-instance and cannot coordinate, and a retry
 * would spend a credit to make the burst worse. So every non-2xx becomes one
 * `unavailable` outcome. No retry, no backoff, no `Retry-After` shown to a rider.
 *
 * Deploy:
 *   supabase functions deploy search-places --project-ref fpmrimzxadewsaiwpsel
 *   supabase secrets set GEOAPIFY_API_KEY=... --project-ref fpmrimzxadewsaiwpsel
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  buildAutocompleteUrl,
  buildLocalityUrl,
  isSearchable,
  parseRequest,
  toLocalityResult,
  toPlaceResults,
} from './shape.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Named GEOAPIFY_API_KEY so the tripwire test can grep for one unambiguous
// token, and shared with `resolve-ride-location` rather than duplicated: one
// key, one vendor, one place to rotate it.
const GEOAPIFY_API_KEY = Deno.env.get('GEOAPIFY_API_KEY')!

/**
 * **A misconfigured deploy must fail on boot rather than spend riders'
 * ceilings**, and `!` above is a type assertion that does nothing at runtime:
 * an unset variable becomes the literal string `undefined` in the query, the
 * vendor answers 401, and the rider reads `unavailable` — *after* the ledger
 * row has committed. At a 250 ms debounce that spends `PER_RIDER_HOURLY` in
 * seconds and locks the rider out for an hour, and fixing the key does not give
 * it back.
 *
 * **This surface is the first that would ever discover a bad key on PROD.**
 * PROD's `ride_map_render_attempts` holds zero rows, so the PROD secret has
 * never been exercised, and `resolve-ride-location` fails *open* — it renders
 * no tile and tells nobody — so it never would have been. Throwing here is what
 * makes the discovery a failed deploy instead of a day of locked-out riders.
 */
if (!GEOAPIFY_API_KEY) throw new Error('search-places: GEOAPIFY_API_KEY is not set')

const LEDGER = 'place_search_attempts'

/**
 * Shorter than `resolve-ride-location`'s 8 s, because a rider is WAITING on this
 * one. That function is fire-and-forget after a save; this is a typeahead, and a
 * request still open after five seconds has been superseded by more typing.
 */
const VENDOR_TIMEOUT_MS = 5_000

/**
 * The caller is `functions.invoke()` in a browser, which sends `Authorization`
 * and `Content-Type` and therefore forces a preflight. A preflight answered with
 * 405 and no CORS headers is blocked before the POST is ever attempted — a
 * `curl` run passes without any of this and the browser still fails.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

/**
 * Every refusal and every empty answer goes through here, so there is exactly
 * one place a term could accidentally be logged and it does not log one.
 *
 * `reason` is a fixed vocabulary — never interpolated from input, never carrying
 * a vendor message. `ceiling` is separated from `unavailable` because the client
 * renders them as different states with a 24× difference in what the rider
 * should do next.
 */
const outcome = (reason: string, status: number, body: unknown) => {
  console.info('search-places:', reason)
  return json(body, status)
}

/**
 * `42501` is `insufficient_privilege` — what an RLS policy raises when its
 * `WITH CHECK` refuses. PostgREST also surfaces its own `PGRST301` for a row
 * that violates the policy. Anything else — `42P01` undefined table,
 * `PGRST205` schema-cache miss, a connection failure with no code at all — is
 * infrastructure, not the rider.
 *
 * Matched on the code rather than the message, because the message is a vendor
 * string that can change under us and is the wrong thing to branch on.
 */
function isPolicyRefusal(error: { code?: string | null } | null): boolean {
  const code = error?.code ?? ''
  return code === '42501' || code === 'PGRST301'
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(VENDOR_TIMEOUT_MS) })
    // A quota or rate-limit response lands here with every other non-2xx, and
    // that is deliberate: the rider-visible outcome is identical to an outage.
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''
  if (!token) return json({ error: 'unauthorized' }, 401)

  // Rule 3. `getUser` validates signature and expiry against GoTrue; a
  // decode-only check would accept the publishable key, which is a valid JWT.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await caller.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return json({ error: 'unauthorized' }, 401)

  // An anonymous session is a real session to GoTrue and holds no terms
  // acceptance. `069`'s participation gate would refuse the ledger row anyway;
  // refusing here spends nothing and gives the client a distinct reason.
  if (user.is_anonymous) return json({ error: 'forbidden' }, 403)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const request = parseRequest(body)
  if (!request) return json({ error: 'bad_request' }, 400)

  // Below the floor is not an error and not a refusal — it is "keep typing",
  // and it costs nothing to answer here rather than at the vendor. The floor is
  // per-mode: a locality term is a stored, complete `profiles.location`, not
  // typing, and three-letter cities are real (`Ede`, `Oss`). See `isSearchable`.
  if (!isSearchable(request.text, request.mode)) {
    return json(request.mode === 'locality' ? { centroid: null } : { results: [] }, 200)
  }

  // Step 5. The ceiling is `069`'s INSERT policy, not an `if` in this file: this
  // function is stateless and multi-instance and cannot count for itself. A
  // refusal here is indistinguishable — by design — between the rider's own
  // ceiling, the application-wide one, and a missing terms acceptance, because
  // all three are conjuncts of one policy. The client renders the difference
  // from `scope`, which PR 2's client half derives from its own request rate;
  // the function does not get to know, and must not guess.
  const { error: ledgerError } = await caller.from(LEDGER).insert({ user_id: user.id })
  if (ledgerError) {
    // **Only a POLICY refusal is the rider's ceiling.** Conflating the rider's
    // ceiling, the app's and the participation gate is deliberate — they are
    // three conjuncts of one policy and the function does not get to know which
    // bound. Conflating those with a MISSING TABLE is not, and it is precisely
    // the state this PR deploys into: `069` is PR 2, so between the owner's
    // deploy and that migration every search would tell the rider they had hit
    // a limit they have not reached. Failing closed is right; blaming the rider
    // for a broken deploy is not, and PR 2's client renders the difference.
    if (!isPolicyRefusal(ledgerError)) {
      return outcome('ledger unavailable', 502, { error: 'unavailable' })
    }
    return outcome('ceiling or gate refused the attempt', 429, { error: 'ceiling' })
  }

  const url =
    request.mode === 'locality'
      ? buildLocalityUrl(request.text, GEOAPIFY_API_KEY)
      : buildAutocompleteUrl(request.text, request.near, GEOAPIFY_API_KEY)

  // BILLABLE from here.
  const payload = await fetchJson(url)
  if (payload === null) {
    return outcome('vendor unavailable', 502, { error: 'unavailable' })
  }

  if (request.mode === 'locality') {
    return json({ centroid: toLocalityResult(payload as never) }, 200)
  }
  return json({ results: toPlaceResults(payload as never) }, 200)
})
