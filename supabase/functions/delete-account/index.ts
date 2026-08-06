/**
 * delete-account — the only thing in this system that may remove an
 * `auth.users` row.
 *
 * ===========================================================================
 * NOT DEPLOYED YET. This file is written and unexercised.
 * ===========================================================================
 * `supabase` CLI is not installed in the build container and the Supabase MCP
 * server exposes no deploy-function tool, so this could not be deployed or run
 * from the session that wrote it. **Nothing in `src/` points at it, deliberately
 * — the flow's own task list says a dead control ships working or not at all.**
 * Before any UI calls this, it must be deployed and exercised against a
 * disposable account: delete succeeds; a second call succeeds; a request
 * carrying another rider's id in the body still deletes only the caller; a
 * request bearing the publishable key is refused; a request with no token is
 * refused. A live run, not a claim — `docs/HANDOFF.md` records three PRs that
 * merged unverified.
 *
 * Deploy:
 *   supabase functions deploy delete-account --project-ref zwprydcyryvudhurbnye
 *   supabase secrets set SERVICE_ROLE_KEY=... --project-ref zwprydcyryvudhurbnye
 *
 * A function deployed by hand and never redeployed is the same class of drift as
 * an unapplied migration, and CI has no path that would catch it.
 *
 * **`supabase/functions` is excluded from `tsconfig.json`**, because this is
 * Deno: `Deno.env`, `Deno.serve` and `jsr:` specifiers do not resolve under the
 * Next compiler, and `tsconfig`'s `include` is `**/*.ts`, so without the
 * exclusion `npx tsc --noEmit` fails on this file and takes CI's whole
 * Type Check job with it. The alternative — adding Deno's types as a
 * devDependency — buys type checking for one file at the cost of a dependency,
 * which §Technology Decisions asks us not to do. **So nothing type-checks this
 * file.** Treat it accordingly: it is the least-guarded code in the repo, which
 * is another reason it must be exercised live before anything points at it.
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
 * Order of operations, and which half is the right one to lose
 * ---------------------------------------------------------------------------
 * Clubs, then objects, then rows.
 *
 *   1. `private.transfer_owned_clubs(sub)` — hands over every club this rider
 *      owns so the `clubs -> postcards` cascade does not destroy other riders'
 *      postcards. Returns the club image paths it surrendered.
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
 * If step 2 fails, the whole call fails and nothing is deleted; the rider
 * retries. If step 3 fails, the objects are already gone — the one genuinely
 * partial state, unavoidable without a distributed transaction, and the right
 * half to lose: images without rows are orphans a sweeper can find, rows without
 * images render broken.
 *
 * Already deleted returns success. The JWT resolves to a subject with no user
 * row, there is nothing to do, and reporting failure would strand a rider on a
 * screen with no exit.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Named SERVICE_ROLE_KEY rather than SUPABASE_SERVICE_ROLE_KEY so that the
// tripwire test can grep for one unambiguous token, and so this never collides
// with a variable a local `supabase start` injects by default.
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

/** The five folder prefixes in the `media` bucket, all keyed on the uploader. */
const PREFIXES = ['postcards', 'avatars', 'covers', 'club-avatars', 'club-covers'] as const
const BUCKET = 'media'
const PAGE = 100

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/**
 * Every object under `<prefix>/<uid>/`, paged.
 *
 * `list()` truncates silently at its limit, so a single call reports success
 * having swept the first page and left the rest — which is exactly the failure
 * mode that produces permanent orphans, because nothing can reach that folder
 * once the account is gone.
 */
async function listAll(
  storage: ReturnType<typeof createClient>['storage'],
  prefix: string,
): Promise<string[]> {
  const names: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`list ${prefix}: ${error.message}`)
    if (!data || data.length === 0) return names
    // `list` returns folder entries with a null id; only real objects have one.
    names.push(...data.filter((e) => e.id !== null).map((e) => `${prefix}/${e.name}`))
    if (data.length < PAGE) return names
  }
}

Deno.serve(async (req: Request) => {
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

  if (userError || !subject) return json({ error: 'unauthorized' }, 401)
  if (subject.is_anonymous) return json({ error: 'unauthorized' }, 401)

  // Rule 1: the subject came from the token. The body is never read — not even
  // to validate it — so there is no id parameter to get wrong.
  const uid = subject.id

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // 1. Clubs first, while the rows that describe them still exist.
    const { data: surrendered, error: transferError } = await admin
      .schema('private')
      .rpc('transfer_owned_clubs', { departing: uid })

    if (transferError) throw new Error(`transfer: ${transferError.message}`)

    // 2. Objects, across the five own-folder prefixes plus any club image the
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

    if (paths.length > 0) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove(paths)
      // Fails the whole call. The rows are what make the objects findable, and
      // after step 3 nothing can enumerate them ever again.
      if (removeError) throw new Error(`storage: ${removeError.message}`)
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
    // Deliberately no subject id in the log line. An audit trail of who deleted
    // their account is a record of the people who asked to have no record
    // (design Q13); the prefix that failed is what an operator actually needs.
    console.error('delete-account failed:', cause instanceof Error ? cause.message : cause)
    return json({ error: 'deletion_failed' }, 500)
  }
})
