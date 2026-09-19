/**
 * send-moderation-digest — sweeps every report surface and rider feedback, and
 * mails one digest to the account owner. The only thing in this system that
 * sends mail the Supabase auth mailer did not send.
 *
 * Linear PD-457. **It supersedes PD-322**, which answered the same question in
 * August with a Slack webhook and an hourly sweep and was never built: there is
 * no Slack webhook anywhere in this repository. Email replaced that answer.
 *
 * ===========================================================================
 * NOT DEPLOYED AS THIS FILE LANDS, AND THAT IS THE ORDINARY STATE
 * ===========================================================================
 * Deploying is an OWNER action on every change under `supabase/functions/`:
 * there is no `supabase` CLI in the build container and `deploy_edge_function`
 * is on `.claude/settings.json`'s `deny` list. Merging is not deploying, so this
 * directory is drift from the moment it merges. Read the state rather than this
 * line:
 *
 *   mcp__Supabase__list_edge_functions fpmrimzxadewsaiwpsel   # DEV
 *   mcp__Supabase__list_edge_functions zwprydcyryvudhurbnye   # PROD
 *   TZ=UTC git log -1 --format=%cd --date=iso-strict-local -- supabase/functions/send-moderation-digest/
 *
 * **The activation order, and one way it differs from `push-notify`'s.** `124`
 * applies, *then* this deploys, *then* the secrets land, *then* the schedule
 * starts. The difference is the third step: `push-notify` drains an outbox a
 * trigger fills, so a deploy with no credentials still had rows waiting. This
 * function claims its own work, and **a deployed function with no provider key
 * burns the attempt cap on every entry it claims** and leaves real reports
 * unsent until somebody re-arms them. Secrets before schedule is not a
 * preference.
 *
 * **One thing this needs no extension for.** Because the sweep *pulls*, the
 * database holds no outbound capability in the delivery path at all — `pg_net`
 * is needed only to invoke this on a clock. So a single hand invocation sends a
 * real digest with no `pg_cron`, no `pg_net` and no Vault secret, and that is
 * the end-to-end proof to take before wiring the schedule.
 *
 * ---------------------------------------------------------------------------
 * NOTHING TYPE-CHECKS THIS FILE
 * ---------------------------------------------------------------------------
 * `tsconfig.json` excludes `supabase/functions` because this is Deno, so
 * `npx tsc --noEmit`, `next build`, Vitest and the RLS suite are all blind to
 * it. **Every decision lives in `shape.ts`** — no Deno global, no `jsr:` import
 * — so `src/__tests__/moderation-digest-shape.test.ts` can import it and `tsc`
 * follows it in. ESLint parses this file and `deno check` (CI's `functions` job)
 * type-checks it; those two are the only tools pointed here. Keep the split.
 *
 * ---------------------------------------------------------------------------
 * FIVE RULES, on `delete-account`'s and `push-notify`'s model
 * ---------------------------------------------------------------------------
 * 1. **The secrets live only in this function's secret store** — the provider
 *    key, the recipient and the sender. `src/__tests__/no-service-role-key.test.ts`
 *    is the tripwire for the key's format and
 *    `moderation-digest-secrets.test.ts` for the addresses.
 * 2. **It takes no arguments.** No body is parsed, no query string is read, and
 *    there is no recipient parameter. There is nothing for a caller to widen.
 * 3. **It verifies the caller itself.** `verify_jwt` at the gateway admits any
 *    signed-in rider's access token and is not this check.
 * 4. **Nothing in the repo type-checks it** — rule 3 above is why that matters.
 * 5. **Zero `.from()`.** The function's entire database reach is two function
 *    names. Four of the five source tables have `service_role`'s grants revoked
 *    (`076` §3b), so `.from('postcard_reports')` would answer `42501` anyway —
 *    and the right reading of that is not *grant it back for the digest* but
 *    *the reach is a list of RPCs*. That is also what makes the projection
 *    enforced at the boundary rather than trusted in TypeScript: there is no
 *    table to read and no argument to widen.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

import { missingMailSecrets, sendDigestMail } from './mail.ts'
import { BATCH_SIZE, renderDigest, type DigestEntry } from './shape.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

type Json = Record<string, unknown>

function jsonResponse(body: Json, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Constant-time string comparison. Copied from `push-notify` for the same
 * reason: a plain `===` on a secret leaks its prefix through timing, the cost
 * here is nil, and these are the only comparisons in the repository whose left
 * side is a credential.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The caller check — rule 3.
 *
 * **It requires the caller to present the exact secret this function holds**,
 * which is strictly stronger than verifying a signature and reading a `role`
 * claim: a signature check admits *any* token this project's secret signed with
 * the right claim, and this admits exactly one value. It is also the only
 * version that survives the current key format — `sb_secret_…` keys are not
 * JWTs and have no signature to verify.
 *
 * **`verify_jwt` is left ON at the gateway as an outer layer, and it is not this
 * check.** It admits any signed-in rider's access token (N1), and `anon`'s key
 * is a valid JWT too (N2) — reading its presence in the config as the caller
 * being verified is the mistake this paragraph exists to prevent.
 */
function assertServiceRoleCaller(req: Request): Response | null {
  if (!SERVICE_ROLE_KEY) {
    // Fail closed, and say which secret is missing rather than 403ing the
    // scheduler for a reason nobody can diagnose from the outside.
    return jsonResponse({ error: 'not_configured', missing: 'SERVICE_ROLE_KEY' }, 500)
  }

  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token || !secretsMatch(token, SERVICE_ROLE_KEY)) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const refusal = assertServiceRoleCaller(req)
  if (refusal) return refusal

  // Rule 2: the request body is never read. There is no argument.

  /**
   * The mail secrets are checked BEFORE anything is claimed, and the ordering is
   * the whole of this block.
   *
   * `sendDigestMail` already refuses without them, but it refuses from *inside*
   * the send: by then a batch is claimed and its `attempts` incremented, and
   * `NOT_CONFIGURED` classifies as `failed` — right for a provider that rejected
   * a mail, wrong for a secret nobody has set yet. So a function deployed ahead
   * of its secrets walks real reports to the attempt cap a tick at a time, and
   * every one of them then needs the hand re-arm in
   * `docs/reference/observability.md` to come back. Nothing is lost either way;
   * the cost is the owner's time, spent on a state that resolves the instant they
   * set the secret — which is this function's own criterion for `retry` rather
   * than `failed`.
   *
   * Refusing here costs one wasted tick instead, and says which secret is
   * missing, in the shape `assertServiceRoleCaller` already uses. The activation
   * order in `docs/ENVIRONMENTS.md` §`send-moderation-digest`'s secrets — secrets
   * before schedule — is what makes this unreachable in the intended path; this
   * is what happens when it is not followed.
   */
  const missing = missingMailSecrets()
  if (missing.length > 0) {
    return jsonResponse({ error: 'not_configured', missing: missing.join(', ') }, 500)
  }

  // The service-role client. It is used for `.rpc()` and nothing else — rule 5.
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: claimed, error: claimError } = await db.rpc('claim_moderation_digest', {
    batch_size: BATCH_SIZE,
  })
  if (claimError) {
    return jsonResponse({ error: 'claim_failed', detail: claimError.message }, 500)
  }

  const entries = (claimed ?? []) as DigestEntry[]

  /**
   * **No empty digest** (N36), and this is the branch that guarantees it.
   *
   * Nothing to report is the ordinary case on most ticks, and it is also the
   * only case where sending would actively do harm: an hourly mail that says
   * *nothing happened* is a mail its reader learns to filter, and a filtered
   * alerting channel is worse than none — the one digest that mattered arrives
   * in the folder with the other hundred. Two concurrent invocations land here
   * too: the loser of the claim's advisory lock gets zero rows and takes exactly
   * this path (N34), so it never calls the provider.
   */
  if (entries.length === 0) return jsonResponse({ entries: 0, sent: false }, 200)

  // Send BEFORE mark (D4, N31). At-least-once, chosen explicitly: mark-then-send
  // loses a report every time the provider is unreachable at the wrong instant,
  // silently, with a marker asserting the opposite. A duplicate line in a later
  // digest costs its reader two seconds.
  const outcome = await sendDigestMail(renderDigest(entries))

  const { error: completeError } = await db.rpc('complete_moderation_digest', {
    entry_ids: entries.map((entry) => entry.entry_id),
    outcome: outcome.disposition,
  })

  /**
   * A `complete` that fails after a send is the one place this function can
   * leave the database disagreeing with the world: the mail is out and the
   * entries stay `claimed`. It is self-healing — the reclaim window frees them
   * and the next tick repeats those lines, which is the annoyance case the
   * at-least-once choice already accepted. Report it rather than 500ing, so a
   * scheduler's log distinguishes it from a send that never happened.
   */
  return jsonResponse(
    {
      entries: entries.length,
      sent: outcome.disposition === 'sent',
      disposition: outcome.disposition,
      provider_status: outcome.status,
      complete_failed: completeError ? completeError.message : null,
    },
    200,
  )
})
