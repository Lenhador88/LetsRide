/**
 * resolve-ride-location — geocodes a ride's `meeting_point`, renders two static
 * map tiles, and stores them against the ride.
 *
 * ===========================================================================
 * NOT DEPLOYED, AND NEVER EXERCISED AGAINST THE VENDOR.
 * ===========================================================================
 * Task 4 of `openspec/changes/add-ride-map-tiles/tasks.md` is titled "written,
 * not deployed", and this file is exactly that. Two separate gaps, and they are
 * not the same gap:
 *
 *   1. **No deploy path exists in a session.** There is no `supabase` CLI in the
 *      build container and the Supabase MCP server exposes no deploy tool, so
 *      task 8.3 is an OWNER ACTION. Same blocker as `delete-account` and PD-86.
 *   2. **`*.geoapify.com` is egress-blocked from the build container.** Not one
 *      request in this file has ever been issued. `WebFetch` returns
 *      `EGRESS_BLOCKED` and so does a bare `curl` through the agent proxy. Every
 *      vendor-facing constant in `gates.ts` therefore says whether it was
 *      measured or assumed, and the three assumed ones are named in that file's
 *      header. **Do not read "the tests pass" as "the vendor agrees."**
 *
 * Task 8.4 is where both close: one real ride create and one real address edit
 * on DEV, confirming tiles appear, that an edit clears then replaces them, and
 * that a non-organizer's call is refused.
 *
 * ---------------------------------------------------------------------------
 * NOTHING TYPE-CHECKS THIS FILE — task 4.10
 * ---------------------------------------------------------------------------
 * `tsconfig.json` excludes `supabase/functions`, because this is Deno:
 * `Deno.env`, `Deno.serve` and `jsr:` specifiers do not resolve under the Next
 * compiler, whose include glob covers every TypeScript file in the repo. Without
 * the exclusion `npx tsc --noEmit` fails here and takes CI's whole Type Check
 * job with it. **So `npx tsc --noEmit` will not see a bug in this file. Neither
 * will `next build`, Vitest, or the RLS suite.** It is the least-guarded code in
 * the repo and a second reviewer pass on it is worth more than a test that
 * cannot run.
 *
 * What that buys `gates.ts` its existence: every *decision* — the three gates,
 * the two URL builders, the path shape, the distance function — lives there, in
 * plain TypeScript with no Deno global and no `jsr:` import, so
 * `src/__tests__/ride-geocode-gates.test.ts` imports it and `tsc` follows it in.
 * **Keep the split.** A decision that migrates into this file is a decision that
 * leaves the test suite, silently.
 *
 * ESLint still parses both files and is the only tool pointed at this one. Do
 * not add this directory to the ESLint ignores to quiet a warning.
 *
 * ---------------------------------------------------------------------------
 * The rules that make it safe, in order of how much they matter
 * ---------------------------------------------------------------------------
 * 1. **No service-role key, anywhere.** Every read, both uploads and the column
 *    write run under the CALLER's forwarded JWT as `authenticated`, subject to
 *    exactly the policies the app itself is subject to. This is decision #8's
 *    *second* reading — a service that forwards the user's JWT — and it is the
 *    first thing in the repo that actually needs it. The property that matters is
 *    not that we were careful: it is that a confused function **cannot exceed its
 *    caller**, so no ride id in a request body can make it act on a ride the
 *    caller could not already edit. `design.md` §D2 records the fallback if a
 *    later constraint ever refuses the direct write, and it is a narrow
 *    `security definer` RPC, not a key.
 * 2. **It takes only a ride id.** No organizer id, no club id, no uid — the
 *    subject comes from the verified JWT and nowhere else. Entitlement is then
 *    decided by reading the ride under the caller's own RLS and comparing
 *    `organizer_id` to that subject, which is RLS deciding rather than an `if`.
 * 3. **It verifies the JWT itself** rather than trusting the gateway, via the
 *    anon client's `getUser(token)`, which resolves the token against GoTrue.
 *    The publishable key is a valid JWT and sails straight past a decode-only
 *    check; against GoTrue it is not a user session and fails.
 * 4. **The Geoapify key lives only in this function's secret store.** Not in
 *    `src/`, not in `.env.local.example`, not in Vercel, not in a fixture, not in
 *    any `NEXT_PUBLIC_*`. `src/__tests__/no-geoapify-key.test.ts` is the
 *    tripwire, and it checks itself — a detector that has quietly stopped
 *    matching passes for ever and looks exactly like a clean repo.
 *
 * ---------------------------------------------------------------------------
 * Order of operations, and why each step is where it is
 * ---------------------------------------------------------------------------
 * Everything cheap and everything refusable happens before anything billable.
 *
 *   1. Verify the token.                                    — no spend
 *   2. Read the ride under the caller's RLS; refuse unless
 *      the caller is `organizer_id`.                        — no spend
 *   3. Blank `meeting_point` -> stop.                       — no spend
 *   4. **Club pre-flight (task 4.4a).** `club_id IS NULL` or
 *      the caller holds a `club_members` row for it.        — no spend
 *   5. **Ledger insert (task 4.4b).** Refused -> stop.      — no spend
 *   6. Geocode, then the three gates.                       — BILLABLE
 *   7. Two renders, then two uploads.                       — BILLABLE
 *   8. Column write; on refusal, delete what was uploaded.
 *
 * **Step 4 exists because step 8 can refuse.** The `rides` UPDATE policy's
 * `WITH CHECK` re-evaluates `(club_id IS NULL) OR private.is_club_member(club_id)`
 * on every update — including one touching only the map columns — and **nothing
 * clears `rides.club_id` when a rider leaves a club**. So an organizer who left
 * the club their ride sits in can read the ride and upload both objects and still
 * have the column write refused. Without step 4 that rider pays for a geocode and
 * two renders on every attempt. `private.is_club_member` is unreachable from here
 * — PostgREST routes only to `public` (`031`) — so the pre-flight reads
 * `club_members` directly under the caller's own RLS.
 *
 * **Step 5 is before step 6 and that ordering is the entire point of the
 * ledger.** It counts *attempts*, not successes. A geocode that returns nothing,
 * returns a city, or times out writes no columns and issues no `UPDATE` on
 * `rides` at all — so a counter that rose on a column write would count only
 * successes and would miss the organizer editing "the usual spot" ten times
 * *because the map will not appear*, who is precisely the rider the ceiling
 * exists to bound. The ceiling itself is `052`'s
 * `private.ride_map_renders_in_window()` inside the ledger's INSERT policy; this
 * function does not count for itself, because it is stateless and a client may
 * call it concurrently.
 *
 * **Step 8's compensating delete is the only moment the object names are still
 * known.** The row never recorded them, and the stale-tile trigger would not have
 * kept them. They are generated here and held for the whole flow for exactly that
 * reason. If the delete also fails the objects stay listable and deletable by the
 * organizer through `051`'s own-folder read arm, rather than becoming permanently
 * unnameable — ordering is the primary rule and that arm is the recovery path.
 *
 * ---------------------------------------------------------------------------
 * Fail-open, everywhere, and what the caller may conclude from a 200
 * ---------------------------------------------------------------------------
 * **A refused render never fails the ride write.** By the time this is called the
 * ride is already saved; the map is an enrichment. Every vendor failure — empty
 * result, sub-floor confidence, rejected granularity, ambiguity, outage, timeout,
 * quota rejection, a refused upload — returns **200 with `rendered: false`** and
 * leaves the columns NULL. The caller fires this and forgets it, and no rider
 * ever sees a map error.
 *
 * `rendered: true` means at least one path was written, and it is the only thing
 * the caller acts on: it invalidates `rides.all()` and `rides.detail(id)` so the
 * new tile is picked up. There is no retry button, no partial-success message and
 * no alerting channel — the last is a KNOWN GAP recorded in the spec rather than
 * solved by inventing one, since error tracking is deliberately undecided.
 *
 * Deploy:
 *   supabase functions deploy resolve-ride-location --project-ref fpmrimzxadewsaiwpsel
 *   supabase secrets set GEOAPIFY_API_KEY=... --project-ref fpmrimzxadewsaiwpsel
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  buildGeocodeUrl,
  buildRideMapPath,
  buildTileUrl,
  resolveCoordinate,
  TILE_SPECS,
} from './gates.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Named GEOAPIFY_API_KEY so the tripwire test can grep for one unambiguous
// token. It exists only in this function's secret store.
const GEOAPIFY_API_KEY = Deno.env.get('GEOAPIFY_API_KEY')!

const BUCKET = 'media'

/**
 * Every vendor call is bounded. An organizer waits on none of this — the caller
 * fires and forgets — but an unbounded fetch holds a function instance open, and
 * a hung geocode would hold it past the ledger row it already spent.
 */
const VENDOR_TIMEOUT_MS = 8_000

/**
 * The app is a client-rendered bundle, so the caller is `functions.invoke()` in a
 * browser. It sends `Authorization` and `Content-Type`, which forces a preflight,
 * and a preflight answered with 405 and no CORS headers is blocked before the
 * POST is ever attempted. A `curl` run passes without any of this and the browser
 * still fails; test both at 8.4.
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

/** Nothing rendered, and the ride is fine. The overwhelmingly common outcome. */
const noTile = (reason: string) => {
  // No address, no coordinate, no uid — a meeting point is frequently a home
  // address and the reason code carries none of it.
  console.info('resolve-ride-location: no tile', reason)
  return json({ rendered: false }, 200)
}

/** Any uuid, anywhere in a message, becomes `<redacted>`. */
const redactUuids = (message: string) =>
  message.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '<redacted>',
  )

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

async function fetchTile(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(VENDOR_TIMEOUT_MS) })
    if (!response.ok) return null
    const blob = await response.blob()
    // The bucket allows `image/jpeg` only and refuses anything else ABOVE every
    // policy, with nothing in the policy set to explain it. Checking here turns
    // that into a skipped upload rather than a confusing Storage error.
    if (!blob.type.startsWith('image/jpeg')) return null
    return blob
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

  // Rule 3. `getUser` validates the signature and expiry against GoTrue; a
  // decode-only check would accept the publishable key, which is a valid JWT.
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await anon.auth.getUser(token)
  const subject = userData?.user

  if (userError || !subject) return json({ error: 'unauthorized' }, 401)
  if (subject.is_anonymous) return json({ error: 'unauthorized' }, 401)

  // Rule 2: a ride id, and nothing else, is read from the body. There is no
  // organizer id, club id or uid parameter to get wrong — the subject above is
  // the only identity this function has.
  let rideId = ''
  try {
    const body = (await req.json()) as { rideId?: unknown }
    if (typeof body?.rideId === 'string') rideId = body.rideId
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (!UUID_RE.test(rideId)) return json({ error: 'bad_request' }, 400)

  // Rule 1: the caller's own token on every statement from here down. The
  // publishable key rides along as `apikey` because PostgREST wants one; the
  // Authorization header is what decides the role and the claims.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // 2. Entitlement, decided by RLS and then by the row itself. A ride this
    //    caller may not see comes back as zero rows, exactly as a ride that does
    //    not exist does — so the refusal below discloses neither.
    const { data: ride, error: rideError } = await caller
      .from('rides')
      .select('id, organizer_id, club_id, meeting_point, map_card_path, map_detail_path')
      .eq('id', rideId)
      .maybeSingle()

    if (rideError) throw new Error(`ride read: ${rideError.message}`)
    if (!ride || ride.organizer_id !== subject.id) return json({ error: 'not_found' }, 404)

    // 3. `meeting_point` is NOT NULL but not non-empty: `rideSchema` trims and
    //    requires it at the action boundary, `001` set no CHECK behind it, and a
    //    Zod rule is advisory once the client owns the mutation path. So any
    //    PostgREST writer can still store whitespace, and geocoding it would spend
    //    money to be told nothing.
    const meetingPoint = (ride.meeting_point ?? '').trim()
    if (!meetingPoint) return noTile('blank_meeting_point')

    // 4. The club pre-flight, before anything billable.
    if (ride.club_id) {
      const { data: membership, error: membershipError } = await caller
        .from('club_members')
        .select('club_id')
        .eq('club_id', ride.club_id)
        .eq('user_id', subject.id)
        .maybeSingle()

      if (membershipError) throw new Error(`membership: ${membershipError.message}`)
      // The organizer left the club. The column write at step 8 would be refused
      // by the UPDATE policy's WITH CHECK arm; stopping here costs nothing.
      if (!membership) return noTile('left_the_club')
    }

    // 5. The ledger, before the vendor call. A refusal is the ceiling, and it is
    //    the ONLY thing standing between a retry loop and an unbounded bill.
    const { error: ledgerError } = await caller
      .from('ride_map_render_attempts')
      .insert({ ride_id: rideId })

    if (ledgerError) return noTile('render_ceiling')

    // 6. BILLABLE from here. Geocode, then the three gates in gates.ts.
    const geocoded = await fetchJson(buildGeocodeUrl(meetingPoint, GEOAPIFY_API_KEY))
    if (!geocoded) return noTile('geocode_unavailable')

    const verdict = resolveCoordinate(geocoded as Parameters<typeof resolveCoordinate>[0])
    if (!verdict.resolved) return noTile(verdict.reason)

    const coordinate = { latitude: verdict.latitude, longitude: verdict.longitude }

    // 7. Two renders at two zooms — see gates.ts TILE_SPECS for why this is not
    //    one render cropped twice. The names are generated HERE and held, because
    //    step 8's compensating delete is the only moment they are known.
    const cardPath = buildRideMapPath(subject.id, crypto.randomUUID())
    const detailPath = buildRideMapPath(subject.id, crypto.randomUUID())

    const [cardTile, detailTile] = await Promise.all([
      fetchTile(buildTileUrl(TILE_SPECS.card, coordinate, GEOAPIFY_API_KEY)),
      fetchTile(buildTileUrl(TILE_SPECS.detail, coordinate, GEOAPIFY_API_KEY)),
    ])

    const upload = async (path: string, tile: Blob | null): Promise<string | null> => {
      if (!tile) return null
      const { error } = await caller.storage
        .from(BUCKET)
        .upload(path, tile, { contentType: 'image/jpeg', upsert: false })
      return error ? null : path
    }

    // ** BOTH TILES OR NEITHER (PD-202). ** A ride with a card tile and no detail
    // tile is not a smaller success, it is a licence problem: `Powered by
    // Geoapify` is mandatory on the Free plan and has exactly one home, the
    // 358×160 detail panel. A card-only render puts vendor imagery in every
    // `RideCard` on `/rides` while the credit renders nowhere in the app.
    //
    // Product owner's decision, 2026-08-12, choosing this over teaching the
    // detail screen about the card tile: the two tiles are one render of one
    // place, and a ride showing a map on the list but not on its own detail page
    // is a worse artifact than no map at all.
    //
    // This REVERSES the "one path present and the other NULL is likewise valid"
    // position that stood in this file until now — that sentence is corrected at
    // step 8 rather than left to contradict this block.
    //
    // The cost is accepted and stated: one flaky render now costs both tiles
    // rather than one, and the ride keeps its coordinate and draws the fallback
    // until its next address edit.
    const bothRendered = !!cardTile && !!detailTile

    const [storedCardPath, storedDetailPath] = bothRendered
      ? await Promise.all([upload(cardPath, cardTile), upload(detailPath, detailTile)])
      : [null, null]

    // An upload can still fail on its own after both fetches succeeded, and that
    // lands us back in the split state by a different door. Delete the survivor
    // rather than referencing it — this is the only moment its name exists.
    if (bothRendered && (!storedCardPath || !storedDetailPath)) {
      const orphan = [storedCardPath, storedDetailPath].filter(
        (path): path is string => path !== null,
      )
      if (orphan.length > 0) await caller.storage.from(BUCKET).remove(orphan)
    }

    const bothStored = !!storedCardPath && !!storedDetailPath

    // 8. The column write. The coordinate is stored even when both uploads
    //    failed: `051`'s one-directional CHECK requires a coordinate under a path
    //    and NOT the reverse, precisely so a successful geocode with a failed
    //    upload stays a valid row rather than losing the coordinate too.
    //
    //    ** One path present and the other NULL is NO LONGER a valid outcome **
    //    — PD-202 reversed that; see the both-or-neither block above. The pair is
    //    written together or not at all.
    //
    //    ** The columns are still written ONLY when the pair actually stored, and
    //    that conditional is load-bearing rather than defensive. ** Writing them
    //    unconditionally means a *failed* render NULLs whatever was already there
    //    — so on a re-render of an unchanged address, a brief outage at the
    //    vendor clears a live tile, and the sweep below then deletes the object it
    //    named. The rider loses a working map to a transient failure, permanently,
    //    because nothing re-renders an address that did not change. The header
    //    promises every vendor failure "leaves the columns NULL"; it must not also
    //    mean "clears columns that were populated". Omitting the keys leaves the
    //    existing values untouched.
    const tileColumns: Record<string, string> = bothStored
      ? { map_card_path: storedCardPath!, map_detail_path: storedDetailPath! }
      : {}

    const { data: written, error: writeError } = await caller
      .from('rides')
      .update({
        latitude: verdict.latitude,
        longitude: verdict.longitude,
        geocode_confidence: verdict.confidence,
        ...tileColumns,
      })
      .eq('id', rideId)
      .select('id')
      .maybeSingle()

    const uploaded = [storedCardPath, storedDetailPath].filter(
      (path): path is string => path !== null,
    )

    if (writeError || !written) {
      // The membership change landed mid-flight, between step 4 and here. This
      // is the only moment these names exist anywhere.
      if (uploaded.length > 0) await caller.storage.from(BUCKET).remove(uploaded)
      return noTile('column_write_refused')
    }

    // The previous tiles for this ride, superseded rather than cleared: the
    // stale-tile trigger only fires on a `meeting_point` change, so a re-render
    // of an unchanged address leaves the old objects with nothing naming them.
    // Best-effort and after the write, never before — deleting first would take
    // a live tile down if the write then failed.
    //
    // ** Scoped to the case where new paths actually REPLACED the old ones. ** An
    // old path is only orphaned if a new path took its column. Under
    // both-or-neither that is all-or-nothing, so the guard is `bothStored` — but
    // it is still a guard rather than an unconditional sweep, because a run that
    // stored nothing leaves BOTH old paths in their columns as the live tiles,
    // and sweeping them would delete objects the row still points at.
    const superseded = (bothStored ? [ride.map_card_path, ride.map_detail_path] : []).filter(
      (path): path is string => !!path && !uploaded.includes(path),
    )
    if (superseded.length > 0) await caller.storage.from(BUCKET).remove(superseded)

    return json({ rendered: uploaded.length > 0 }, 200)
  } catch (cause) {
    // A meeting point is frequently a home address and a ride id resolves to
    // one, so the boundary redacts rather than the call sites. `delete-account`
    // learned that the expensive way: it trusted its throw sites and leaked a
    // uid through a Storage error message anyway.
    console.error(
      'resolve-ride-location failed:',
      redactUuids(cause instanceof Error ? cause.message : String(cause)),
    )
    // Still 200. The ride is already saved and the caller must not surface a map
    // error; a 500 here would show up as a failed `invoke` in a browser console
    // for a rider whose ride saved perfectly.
    return json({ rendered: false }, 200)
  }
})
