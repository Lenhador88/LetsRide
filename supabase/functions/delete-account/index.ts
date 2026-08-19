/**
 * delete-account — the only thing in this system that may remove an
 * `auth.users` row.
 *
 * ===========================================================================
 * THE DEPLOY MOVES WITHOUT THIS FILE MOVING. Read the state, not this line.
 * ===========================================================================
 * Every claim below carries the command that re-takes it. Do not hand-count how
 * far behind the deployed build is — a headline count here was wrong within one
 * commit of being written — and do not hardcode a deploy date into the range,
 * which is how the FIX for that went wrong on its first pass. Read the date off
 * the deploy, then use it:
 *
 *   mcp__Supabase__list_edge_functions zwprydcyryvudhurbnye   # PROD
 *   mcp__Supabase__list_edge_functions fpmrimzxadewsaiwpsel   # DEV
 *   # status ACTIVE, verify_jwt true, ezbr_sha256 EQUAL across the two
 *
 *   git log --oneline --since=<the updated_at above> -- supabase/functions/delete-account/
 *   # empty means the deploy is current; anything listed is what it is missing
 *
 * **Read what that range CONTAINS, not how many commits it holds.** A commit
 * that only rewrites this header lands in it too, so the check reads "stale"
 * for a change that cannot alter behaviour. It errs in the safe direction and
 * is not a reason to redeploy: open the diff.
 *
 * **`ezbr_sha256` equality across the two projects is NOT a currency check** —
 * it says PROD and DEV agree, never that either matches this file. The check
 * that answers currency is the pair above: a deploy `updated_at` NEWER than
 * this directory's last behavioural commit — equivalently, nothing in the
 * `git log` range that touches executable lines.
 *
 * Measured 2026-08-17T14:32Z, after the owner redeployed by hand: **PROD v9 and
 * DEV v5, `ezbr_sha256` 9793933d…, both current** — the re-authentication proof
 * below is live on both projects, and `PREFIXES` at the bottom of this file is
 * what the live build sweeps, `ride-maps` included.
 *
 * **PROD's `SERVICE_ROLE_KEY` is PROVEN**, `PD-86`, closed 2026-08-16: a real
 * PROD deletion, verified in the database rather than off the 200 — `auth.users`,
 * `profiles` and `auth.identities` gone, re-sign-in refused. Do not re-run that
 * probe to reassure yourself; it costs a real account. What is NOT settled is
 * whether the proof below actually RUNS — see the CONTENT note.
 *
 * **The re-authentication proof (task 3.4) landed with PD-102 (2026-08-16).**
 * `req.json()` below reads a `{ password }` body and verifies it with
 * `signInWithPassword` before anything destructive runs (D6). A build older
 * than that commit deletes on a valid bearer token alone and silently ignores
 * a password the client sends — which is what the two commands above exist to
 * rule out before anyone trusts the sheet.
 *
 * **Committing the function ahead of the client, inside one branch, does NOT
 * make a redeploy fail-closed, and an earlier revision of this comment
 * claimed it did — reviewer finding #1, 2026-08-16.** Both commits merge
 * together; the client half auto-deploys on merge, the function half deploys
 * by hand, later, if at all — commit order inside a branch says nothing about
 * *deploy* order, which is the thing that would actually matter and which no
 * session can control. What made it fail-closed instead was a client flag,
 * `NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED` — the "Delete account" row did not
 * render until that project's env var read `'true'`.
 *
 * **That flag and `src/lib/flags.ts` were deleted on 2026-08-19**, once this
 * build was verified by content (below), on the product owner's instruction.
 * The row now renders unconditionally, so **this file is the only gate on the
 * destructive path, which is where the gate always actually was**: a client
 * flag never protected this endpoint. It is live under `verify_jwt`, so any
 * signed-in rider's own access token reaches it with or without a UI — which
 * is why the ordering lesson above still stands even though the mechanism
 * enforcing it is gone.
 * **Verify the redeploy by CONTENT, not by sha alone** — 2.3a and 3.4 both
 * name the same reason: three tasks now want the same redeploy, so a changed
 * `ezbr_sha256` no longer proves any one of them shipped. A request with no
 * `password` field must come back `reauth_required`. **That check alone does
 * not prove the wrong-password path works** — an empty password never
 * reaches `signInWithPassword`, so it only exercises the guard above that
 * call, not `classifyAuthError`'s classification of a real, non-empty wrong
 * password. Verifying that needed its own probe (reviewer, 2026-08-17), and
 * the probe ran on 2026-08-19: a real non-empty wrong password also comes
 * back `reauth_required`, never `verification_unavailable`. Seven cases in
 * `add-account-deletion`'s task 2.6.
 *
 * **And "nothing calls it" is not the same as "nobody can", which makes the
 * ordering stronger than it first reads.** The endpoint is live with
 * `verify_jwt`, so any signed-in rider's own access token already destroys their
 * account in one request — no UI required, and anything running in the page
 * holding that token can do it too. Deploying the stricter build first therefore
 * CLOSES a gap that is open right now; it does not merely avoid opening one.
 *
 * Measured against DEV 2026-08-14 — the gateway does not want an `apikey` at
 * all, which is the part that looks wrong and is not:
 *
 *   POST .../functions/v1/delete-account
 *     no headers                      401 UNAUTHORIZED_NO_AUTH_HEADER
 *     apikey: garbage                 401 UNAUTHORIZED_NO_AUTH_HEADER
 *     Authorization: Bearer garbage   401 UNAUTHORIZED_INVALID_JWT_FORMAT
 *
 * So `Authorization: Bearer <a rider's access token>` is the whole requirement.
 * An `apikey` header alone does not even count as authentication, and the
 * publishable key in the Authorization slot is refused at `getUser` below.
 *
 * Deploy — an OWNER action, dashboard rather than CLI (`PD-86`):
 *   supabase functions deploy delete-account --project-ref zwprydcyryvudhurbnye
 *   supabase secrets set SERVICE_ROLE_KEY=... --project-ref zwprydcyryvudhurbnye
 *
 * A function deployed by hand and never redeployed is the same class of drift as
 * an unapplied migration, and CI has no path that would catch it.
 *
 * **`supabase/functions` is excluded from `tsconfig.json`**, because this is
 * Deno: `Deno.env`, `Deno.serve` and `jsr:` specifiers do not resolve under the
 * Next compiler, whose include glob covers every TypeScript file in the repo —
 * so without the exclusion `npx tsc --noEmit` fails on this file and takes CI's
 * whole Type Check job with it. The alternative, adding Deno's types as a
 * devDependency, buys type checking for one file at the cost of a dependency,
 * which §Technology Decisions asks us not to do. **So nothing type-checks this
 * file.** Treat it accordingly: it is the least-guarded code in the repo, which
 * is another reason it must be exercised live before anything points at it.
 *
 * ESLint *does* still parse it, and that is worth keeping. It is the only tool
 * left pointed at this file, and it immediately earned its place: the sentence
 * above originally spelled the include glob out literally, and the `*` `/` pair
 * inside it closed this comment block early and turned the rest of the header
 * into syntax errors. `tsc` could not see it. Do not add this directory to the
 * ESLint ignores to make a warning go away.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all, against decision #8
 * ---------------------------------------------------------------------------
 * Removing an `auth.users` row needs the Auth admin API, which needs the
 * service-role key. That is decision #8's FIRST reading — "more server compute,
 * same database" — and not its third. This function owns one operation; it does
 * not own the database. Every other read and write in the app still goes through
 * RLS under the rider's own JWT.
 *
 * A `security definer` RPC cannot substitute: `auth.admin` is an HTTP API, not a
 * SQL surface, and a definer function deleting from `auth.users` would put a
 * row-deleting privileged function on PostgREST's published surface — the thing
 * `009` moved `is_blocked` into `private` to avoid.
 *
 * ---------------------------------------------------------------------------
 * The three rules that make it safe, in order of how much they matter
 * ---------------------------------------------------------------------------
 * 1. **It takes no user id.** Not in the body, not in a query parameter, not in
 *    a header. The subject comes from the verified JWT and nowhere else. A
 *    service-role endpoint that accepts an id is account-deletion-as-a-service
 *    for whoever finds the URL, and "we check the id matches the caller" is one
 *    refactor away from not doing that. Removing the parameter removes the
 *    class of bug rather than guarding against it.
 * 2. **It verifies the JWT itself** rather than trusting the gateway, using the
 *    anon client's `getUser(token)` — which validates the signature and
 *    expiry server-side against GoTrue.
 * 3. **The service-role key never leaves this file's environment.** Not in
 *    `src/`, not in `.env.local.example`, not in Vercel, not in a fixture, not
 *    in any `NEXT_PUBLIC_*` variable. `src/__tests__/no-service-role-key.test.ts`
 *    is the tripwire.
 *
 * ---------------------------------------------------------------------------
 * Order of operations, and what a failure between them actually leaves
 * ---------------------------------------------------------------------------
 * Re-auth, then clubs, then objects, then rows.
 *
 *   0. The re-authentication proof (PD-102, above). Refuses before anything
 *      else runs — `reauth_required`, not `unauthorized` — so a wrong password
 *      never reaches the transfer, the sweep or the delete.
 *   1. `transfer_owned_clubs_for_deletion(sub)` — hands over every club this
 *      rider owns so the `clubs -> postcards` cascade does not destroy other
 *      riders' postcards. Returns the club image paths it surrendered.
 *   2. Storage delete, across all five prefixes plus the surrendered club
 *      images. **Objects before rows**, because the rows are what say which
 *      objects exist; the reverse leaves bytes nothing can enumerate, which is
 *      the mess `scripts/storage/sweep-orphans.mjs` was written to clean up
 *      after — and no credential can reach a departed rider's folder afterwards.
 *   3. `deleteUser(sub, false)` — a HARD delete. Supabase's soft delete keeps
 *      the email address, which is personal data we just told the rider was
 *      erased, and keeps that address from being reusable — turning a deletion
 *      into a permanent ban on the person's email.
 *
 * **THERE IS NO TRANSACTION ACROSS THESE THREE, and an earlier version of this
 * comment claimed otherwise.** It said "if step 2 fails, the whole call fails
 * and nothing is deleted", copying design D7's "a failure before the auth delete
 * leaves everything intact" and D2's "inside the deletion, in one transaction".
 * Step 1 is a PostgREST call: it commits when the HTTP response returns, before
 * step 2 begins. No arrangement of these three can be atomic — one is SQL, one
 * is the Storage API and one is the Auth API.
 *
 * What is true instead, and what the design should have said:
 *
 *   - **Every step is idempotent, so the retry completes.** Step 1 finds no
 *     owned clubs the second time. Step 2 re-lists and removes whatever is left.
 *     Step 3 is the already-gone branch below.
 *   - **A failure after step 1 leaves the rider an ordinary member** of the
 *     clubs they used to own — not ejected from them. That is `032`, and it
 *     exists precisely because `029` deleted the membership row here and made a
 *     transient Storage error permanently eject someone from a private club they
 *     could no longer rejoin.
 *   - **A failure after step 2 leaves orphaned bytes and live rows**, which is
 *     the right half to lose: images without rows are orphans a sweeper can
 *     find, rows without images render broken.
 *
 * **Already deleted returns `unauthorized` (401), not success**, and that is
 * worth stating plainly because both this file and D7 previously claimed the
 * opposite. The `getUser` call below runs first, and GoTrue is documented to
 * reject a token whose `sub` has no user row — so a retry against an account
 * that is already gone never reaches the `deleteUser` already-gone branch.
 * **This shape was inferred until 2026-08-19 and is now measured**: the
 * 2026-08-14 probe never replayed a real, well-formed token against a deleted
 * account — only a missing header, a garbage `apikey`, and a garbage bearer.
 * The replay ran on
 * DEV against this deployed build (v5, `ezbr_sha256` 9793933d…): a disposable
 * account deleted, then the same still-unexpired access token sent again,
 * answering `{"error":"unauthorized"}` 401 — `add-account-deletion`'s task 2.6
 * carries the table. The client contract
 * is therefore: **the `unauthorized` code on this endpoint means the session
 * is dead, which for the deletion screen is indistinguishable from success
 * and must be treated as such.** The already-gone branch in step 3 still
 * earns its place — it covers the account disappearing between `getUser` and
 * `deleteUser`.
 *
 * **The response carries THREE distinct codes now, not two, and the client
 * must not fold any of them into another (reviewer finding #2, 2026-08-16).**
 *
 *   - `unauthorized` (401) — the token itself was actively rejected. Read as
 *     "already gone" above.
 *   - `reauth_required` (401 — same status, different body) — the token is
 *     fine, the password proof is missing or wrong. The account is NOT gone;
 *     treating this as "session dead, deletion succeeded" would sign a rider
 *     out and report success on a simple typo, on the one action with no
 *     undo. Comes from step 0, below.
 *   - `verification_unavailable` (503) — `getUser` could not get a real
 *     answer from GoTrue at all (a network failure reaching it from the Edge
 *     runtime, or GoTrue itself 5xx'ing). This says NOTHING about the token
 *     or the account — it is the same brief outage this endpoint could hit on
 *     any call — and folding it into `unauthorized` reported an untouched
 *     account as deleted, which is the false-positive erasure reviewer
 *     finding #2 named. The client must retry, never sign out, on this one.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Named SERVICE_ROLE_KEY rather than SUPABASE_SERVICE_ROLE_KEY so that the
// tripwire test can grep for one unambiguous token, and so this never collides
// with a variable a local `supabase start` injects by default.
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

/**
 * HTTP statuses from GoTrue that actually ASSERT the caller was rejected,
 * rather than merely being outside the 5xx/network band
 * `AuthRetryableFetchError` already covers. `getUser` (`/user`) and
 * `signInWithPassword` (`/token?grant_type=password`) do not share a status
 * vocabulary for "rejected" — reusing one allowlist across both endpoints
 * misclassified every wrong password as `verification_unavailable`, because
 * a wrong password is reported at 400, which is outside `{401, 403}`
 * (reviewer, 2026-08-17). Each call site below gets its own set.
 *
 * `getUser`: `401` is measured against DEV, 2026-08-14 (this file's own
 * header) — for the shapes that measurement actually exercised: no
 * `Authorization` header, a malformed JWT, a signature that does not
 * verify. It does NOT cover a token whose session was cascade-deleted,
 * which is `AuthSessionMissingError`, handled by name in `classifyAuthError`
 * rather than by status — see there. Nor does it cover a well-formed token
 * whose `sub` has no `auth.users` row (the already-deleted case): that shape
 * is inferred from GoTrue's documented behaviour, not measured here either
 * — see the file header. `403` is INFERRED too: no case here has produced
 * one, but it is the same class (GoTrue refusing on authorization grounds,
 * e.g. a banned account) and belongs beside 401 rather than being silently
 * absorbed into `verification_unavailable`'s "we could not tell" bucket.
 */
const GETUSER_REJECTED_STATUSES = new Set([401, 403])

/**
 * `signInWithPassword`: a wrong password comes back 400, not 401/403
 * (`{"code":400,"error_code":"invalid_credentials"}`, reported against DEV).
 * **The classification is now measured end to end against this deployed
 * build, 2026-08-19**: a valid token plus a real non-empty wrong password
 * answers `reauth_required` 401 — which is what this set buys, since 400 is
 * absent from `GETUSER_REJECTED_STATUSES` and the same password would
 * otherwise classify as `'unavailable'` and tell a rider to retry on a typo.
 * `add-account-deletion`'s task 2.6 carries the table. Kept in its own set rather
 * than added to `GETUSER_REJECTED_STATUSES`, because widening that set to
 * include 400 would reopen the `AuthSessionMissingError` regression at
 * `getUser` (also a synthetic 400 — see `classifyAuthError`) and would also
 * catch a 400 at `getUser` for an unrelated reason. Other 400s at THIS
 * endpoint (a validation error, an unconfirmed email) are also read as
 * `'rejected'` under this set — the residual ambiguity is accepted rather
 * than resolved by `error_code`, because nothing is deleted either way; the
 * worst case is a rider told "wrong password" for a different reason, not
 * data lost.
 */
const REAUTH_REJECTED_STATUSES = new Set([400])

/**
 * Classifies a GoTrue-originated error against a caller-supplied allowlist of
 * "the caller was actively rejected" statuses. Both call sites share this
 * shape, with their own allowlist, so neither can forget the one check that
 * does not vary by endpoint.
 *
 * Checked by NAME first, not status, for exactly one case —
 * `AuthSessionMissingError`. auth-js's `handleError` (`lib/fetch.js`)
 * intercepts GoTrue's `session_not_found` error CODE before it ever looks at
 * the HTTP status, and the class's own constructor hardcodes status `400`
 * regardless of what GoTrue actually answered (`lib/errors.js`) — the 400 is
 * synthetic and reflects no real response. Deleting an `auth.users` row
 * cascades its `auth.sessions` rows, so this is D7's most likely shape for
 * the already-deleted case: a second device holding a still-unexpired
 * access token. At `getUser` this is squarely the case the check exists
 * for. At `signInWithPassword` a password grant has no session to look up,
 * so `session_not_found` cannot occur there today and this branch is dead
 * code at that call site — kept anyway, because a name check ahead of a
 * status check is correct regardless of which status set follows it.
 *
 * The status check is the rule for everything else, and stays fail-safe on
 * the class it was originally trusted not to need: `AuthUnknownError`
 * carries no status at all, and `typeof status === 'number'` being false for
 * it already routes to `'unavailable'` rather than being read as a rejection
 * by accident.
 */
function classifyAuthError(
  error: unknown,
  rejectedStatuses: ReadonlySet<number>,
): 'rejected' | 'unavailable' {
  const name = (error as { name?: string } | null)?.name
  if (name === 'AuthSessionMissingError') return 'rejected'

  const status = (error as { status?: number } | null)?.status
  return typeof status === 'number' && rejectedStatuses.has(status) ? 'rejected' : 'unavailable'
}

/**
 * The folder prefixes in the `media` bucket, all keyed on the uploader.
 *
 * **`ride-maps` was added by PD-104 §4 and this list is the ONLY thing that
 * deletes it.** Those tiles are static maps centred on a ride's meeting point,
 * which is frequently the organizer's home address — so leaving them out means
 * an account deletion removes the `auth.users` row, cascades the `rides` away,
 * and leaves two rendered images of where that rider lives in the bucket with no
 * row naming them and no credential in the system able to reach the folder.
 *
 * **This file is deployed and no session can redeploy it** (no `supabase` CLI in
 * the build container, no deploy tool on the MCP server), so this edit is drift
 * until the owner redeploys — which is why `add-ride-map-tiles/tasks.md` blocks
 * 8.3 on it: the render function's deploy and this redeploy are the same window,
 * and deploying the renderer first is what opens the gap.
 */
const PREFIXES = [
  'postcards',
  'avatars',
  'covers',
  'club-avatars',
  'club-covers',
  'ride-maps',
] as const
const BUCKET = 'media'
const PAGE = 100
/** `remove()` takes a path list in one request; a large folder must be chunked. */
const REMOVE_CHUNK = 100
/** Depth guard for the recursive list — see `listAll`. */
const MAX_DEPTH = 8

/**
 * The app is a client-rendered bundle, so the caller is `functions.invoke()` in
 * a browser. It sends `Authorization` and `Content-Type`, which forces a
 * preflight — and a preflight that gets a 405 with no CORS headers is blocked
 * before the POST is ever attempted. Every official Supabase template ships this
 * for the same reason.
 *
 * Worth knowing before task 2.6's live exercise: a `curl` run passes without
 * any of this, and the browser still fails. Test both.
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
 * Every object under `<prefix>/<uid>/`, paged AND recursed.
 *
 * Two failure modes, both of which leave personal data behind for ever, because
 * once `deleteUser` runs no credential in this system can reach the folder —
 * every Storage policy is scoped to a live rider's own uid.
 *
 * **Paging**: `list()` truncates silently at its limit, so a single call reports
 * success having swept the first page.
 *
 * **Nesting**: `list()` returns one level, and sub-folders come back as entries
 * with `id === null`. Filtering those out without recursing looks correct and
 * silently skips everything under them — and nested paths ARE legal today:
 * `010`/`014`'s policies and the path CHECKs are all
 * `like 'postcards/' || uid || '/%'`, and `%` matches `/`, so
 * `postcards/<uid>/anything/photo.jpg` uploads fine. Nothing in the app creates
 * such a path, which is exactly why this would never have been noticed.
 */
async function listAll(
  storage: ReturnType<typeof createClient>['storage'],
  prefix: string,
  depth = 0,
): Promise<string[]> {
  if (depth >= MAX_DEPTH) return []
  const names: string[] = []
  const folders: string[] = []

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.from(BUCKET).list(prefix, { limit: PAGE, offset })
    // NOTE: the prefix contains the rider's uid, so it must never reach the
    // thrown message — the catch at the bottom logs whatever it is given, and
    // Q13 forbids writing a departing rider's id into a log.
    if (error) throw new StorageListError(error.message)
    if (!data || data.length === 0) break
    for (const entry of data) {
      if (entry.id === null) folders.push(`${prefix}/${entry.name}`)
      else names.push(`${prefix}/${entry.name}`)
    }
    if (data.length < PAGE) break
  }

  for (const folder of folders) {
    names.push(...(await listAll(storage, folder, depth + 1)))
  }
  return names
}

/** Carries no path, so the uid cannot reach a log line through it. */
class StorageListError extends Error {
  constructor(detail: string) {
    super(`storage list failed: ${detail}`)
  }
}

/** Any uuid, anywhere in a message, becomes `<redacted>`. See the catch block. */
const redactUuids = (message: string) =>
  message.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '<redacted>',
  )

Deno.serve(async (req: Request) => {
  // Before the method check, or the preflight is answered with 405 and the
  // browser never sends the POST.
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''
  if (!token) return json({ error: 'unauthorized' }, 401)

  // Rule 2: verify the token rather than trusting the gateway. The publishable
  // key is a valid JWT and would sail past a decode-only check; `getUser`
  // resolves it against GoTrue, where it is not a user session and fails.
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await anon.auth.getUser(token)
  const subject = userData?.user

  // `'rejected'` means the token was actively refused — including the
  // cascade-deleted-session case, by name — and is reported as
  // `unauthorized`, which the client reads as "already gone" (D7).
  // `'unavailable'` means GoTrue never gave a real answer at all — a
  // network failure, a 5xx, a rate limit — and must never be read as a
  // rejection: that reports an untouched account as deleted and signs the
  // rider out with nothing actually removed.
  if (userError) {
    return classifyAuthError(userError, GETUSER_REJECTED_STATUSES) === 'rejected'
      ? json({ error: 'unauthorized' }, 401)
      : json({ error: 'verification_unavailable' }, 503)
  }
  if (!subject) return json({ error: 'unauthorized' }, 401)
  if (subject.is_anonymous) return json({ error: 'unauthorized' }, 401)

  // Rule 1: the subject came from the token, never from the body. The only
  // thing read out of the body is the re-auth proof below — never an id.
  const uid = subject.id

  // ---------------------------------------------------------------------
  // Re-authentication (design D6, Q7 — decided 2026-08-14: require the
  // password). A live access token proves the SESSION is live; it does not
  // prove the person holding the phone knows the password, which is the
  // separate claim D6 asks for — an unlocked, unattended or stolen phone is
  // otherwise two taps from an unrecoverable loss. Checked here, in the
  // function, because a check the client performs is one a modified client
  // skips (account-deletion §"A live session is not sufficient on its own").
  //
  // A distinct error code from the token check above (`reauth_required`, not
  // `unauthorized`) on purpose: `unauthorized` above means the JWT itself did
  // not verify, which — for a token this same client just used to reach this
  // line — can only mean the account is already gone (D7's already-deleted
  // case, see the file header). `reauth_required` means the token is fine but
  // the password proof is missing or wrong, which must NOT be read the same
  // way: an account that still exists must not be treated as deleted because
  // of a mistyped password.
  //
  // No JSON body reaches this endpoint from any caller today, so
  // `req.json()` throwing on an empty body is the ordinary case rather than
  // an error to log.
  let body: { password?: unknown } = {}
  try {
    body = (await req.json()) as { password?: unknown }
  } catch {
    // No body, or not JSON — treated as no password below, not as a parse
    // failure. The response must not distinguish "sent nothing" from "sent
    // the wrong thing" — see the scenario "repeated wrong attempts do not
    // become an oracle".
  }
  const password = typeof body.password === 'string' ? body.password : ''

  // `subject.email` is missing only for a shape this app never creates
  // (there is no OAuth/phone signup path), but the check costs nothing and
  // means this can never call `signInWithPassword` with an empty email.
  if (!password || !subject.email) {
    return json({ error: 'reauth_required' }, 401)
  }

  // Verified by asking GoTrue to sign the password in, on the SAME anon
  // client already constructed above for `getUser`. `persistSession: false`
  // means this never writes anywhere — the returned session, if any, is
  // discarded; only `error` is read.
  //
  // This endpoint rate-limits the password grant harder than `/user`, so a
  // `429` here must stay `'unavailable'` — folding it into `reauth_required`
  // would tell a rate-limited rider their password is wrong.
  // `REAUTH_REJECTED_STATUSES` covers only the measured wrong-password
  // status (see its own comment); everything else GoTrue could return here
  // is treated the same as an outage. Nothing is deleted either way, so the
  // worst case of getting this wrong is a rider told to retry rather than
  // told the truth — never data lost.
  const { error: reauthError } = await anon.auth.signInWithPassword({
    email: subject.email,
    password,
  })
  if (reauthError) {
    return classifyAuthError(reauthError, REAUTH_REJECTED_STATUSES) === 'rejected'
      ? json({ error: 'reauth_required' }, 401)
      : json({ error: 'verification_unavailable' }, 503)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // 1. Clubs first, while the rows that describe them still exist.
    //
    // Through 031's `public` wrapper, NOT `.schema('private')` — PostgREST only
    // routes to `public`, so a private-schema RPC is refused before it reaches
    // Postgres, and service_role held no USAGE on `private` either. Measured;
    // 031's header carries both queries. The wrapper is privilege-free and
    // executable by service_role alone.
    //
    // It takes a uuid, which is the one place an id crosses a boundary in this
    // flow. That is safe here and only here: the caller is this function, the
    // id came from `getUser(token)` twenty lines above, and the endpoint is
    // unreachable without the service-role key. Rule 1 is enforced at the HTTP
    // boundary, where a rider's identity actually exists.
    const { data: surrendered, error: transferError } = await admin
      .rpc('transfer_owned_clubs_for_deletion', { departing: uid })

    if (transferError) throw new Error(`transfer: ${transferError.message}`)

    // 2. Objects, across every own-folder prefix in PREFIXES plus any club image the
    //    transfer surrendered — those live under this rider's folder but belong
    //    to a club that may now have a different owner, which is why 029 nulls
    //    the path rather than leaving a dangling reference.
    const own = await Promise.all(
      PREFIXES.map((prefix) => listAll(admin.storage, `${prefix}/${uid}`)),
    )
    const paths = [
      ...own.flat(),
      ...((surrendered ?? []) as { object_path: string }[]).map((r) => r.object_path),
    ]

    // Chunked: `remove()` sends the whole list in one request, and a rider with
    // a large postcards folder would exceed the request limit — which fails the
    // call and, before 032, used to leave them ejected from their own clubs.
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
      const { error: removeError } = await admin.storage
        .from(BUCKET)
        .remove(paths.slice(i, i + REMOVE_CHUNK))
      // Fails the whole call. The rows are what make the objects findable, and
      // after step 3 nothing can enumerate them ever again. The retry re-lists,
      // so a chunk that already succeeded is simply not found the second time.
      if (removeError) throw new Error(`storage remove failed: ${removeError.message}`)
    }

    // 3. The auth row. Hard delete — the second argument is `shouldSoftDelete`.
    //    Everything in `public` goes with it through the thirteen cascading FKs.
    const { error: deleteError } = await admin.auth.admin.deleteUser(uid, false)

    if (deleteError) {
      // Already gone is success, not failure: there is nothing left to do and a
      // 500 here strands the rider on a screen with no exit.
      const message = deleteError.message.toLowerCase()
      const alreadyGone =
        deleteError.status === 404 || message.includes('not found')
      if (!alreadyGone) throw new Error(`auth: ${deleteError.message}`)
    }

    return json({ deleted: true }, 200)
  } catch (cause) {
    // Q13: the function may log, but never with a subject id. An audit trail of
    // who deleted their account is a record of the people who asked to have no
    // record.
    //
    // Redacted at the boundary rather than at each call site. An earlier version
    // trusted the throw sites and leaked anyway — `listAll` threw
    // `list ${prefix}: …` where the prefix was `postcards/<uid>`, under a comment
    // asserting no id was logged. The call sites are now clean too, but they are
    // not the control: any message from the Storage or PostgREST SDK may quote a
    // path back, and this is the one place that sees all of them.
    console.error('delete-account failed:', redactUuids(
      cause instanceof Error ? cause.message : String(cause),
    ))
    return json({ error: 'deletion_failed' }, 500)
  }
})
