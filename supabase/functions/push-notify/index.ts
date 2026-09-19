/**
 * push-notify — drains the push outbox and hands each notification to APNs or
 * FCM. The only thing in this system that talks to Apple or Google.
 *
 * ===========================================================================
 * NOT DEPLOYED AS THIS FILE LANDS, AND THAT IS THE ORDINARY STATE
 * ===========================================================================
 * Deploying is an OWNER action on every change under `supabase/functions/`:
 * there is no `supabase` CLI in the build container and `deploy_edge_function`
 * is on `.claude/settings.json`'s `deny` list. Merging is not deploying, so
 * this directory is drift from the moment it merges. Read the state rather than
 * this line:
 *
 *   mcp__Supabase__list_edge_functions fpmrimzxadewsaiwpsel   # DEV
 *   mcp__Supabase__list_edge_functions zwprydcyryvudhurbnye   # PROD
 *   TZ=UTC git log -1 --format=%cd --date=iso-strict-local -- supabase/functions/push-notify/
 *
 * Verify a deploy **by content**, never by a moved `ezbr_sha256` — a moved
 * digest proves a deploy happened, never which build (PD-249). And equality of
 * the digest across the two projects says the projects agree, never that either
 * matches this file.
 *
 * **The activation ORDER is not this function's to choose and it is not
 * symmetrical** (task 3.24). `121` applies, *then* this deploys, *then* the
 * schedule starts. The trigger writes outbox rows from the instant `121`
 * applies, so a schedule started before anything drains them leaves a table
 * growing with no reader; a deploy before the schedule costs nothing at all.
 *
 * ---------------------------------------------------------------------------
 * NOTHING TYPE-CHECKS THIS FILE
 * ---------------------------------------------------------------------------
 * `tsconfig.json` excludes `supabase/functions` because this is Deno, so
 * `npx tsc --noEmit`, `next build`, Vitest and the RLS suite are all blind to
 * it. This is the least-guarded code in the repository and it now holds the
 * largest secret set in it — design D11 rule 4, which applies unchanged.
 *
 * **Every decision lives in `shape.ts`** — no Deno global, no `jsr:` import —
 * so `src/__tests__/push-notify-shape.test.ts` can import it and `tsc` follows
 * it in. **Keep the split.** ESLint parses this file and is the only tool
 * pointed at it; do not add the directory to the ignores.
 *
 * ---------------------------------------------------------------------------
 * The rules that make it safe, in order of how much they matter
 * ---------------------------------------------------------------------------
 * Design D11 ruled on `delete-account`'s four rules one at a time rather than
 * inheriting them, and added a fifth this function needs and that one did not.
 *
 * **1. The secrets live only in the function's secret store — and this widens
 * it.** Three more than `delete-account` holds: the APNs `.p8` (a PEM private
 * key), its key id and team id, and the FCM service-account JSON.
 * `src/__tests__/no-service-role-key.test.ts` carries a detector for each
 * format and proves each still catches a real key of that format — because a
 * guard that has quietly stopped matching passes for ever and looks exactly
 * like a clean repository.
 *
 * **2. It takes no arguments from anyone.** `delete-account`'s "takes no user
 * id" does not apply as written, because no rider calls this function at all.
 * There is no body, no query string and no id of any kind; the subject set
 * comes from `claim_push_batch` and nowhere else. A confused deputy here cannot
 * be pointed at a rider.
 *
 * **3. It verifies the caller itself, and the check is sharper than
 * `verify_jwt`.** `verify_jwt: true` is satisfied by ANY signed-in rider's own
 * access token — exactly as it is satisfied by the publishable key — so it is
 * not the check. See `assertServiceRoleCaller` below for what is, and why it
 * departs from D11's literal wording in the direction of being stronger.
 *
 * **4. Nothing type-checks it.** Above.
 *
 * **5. It issues no `.from()`.** Its entire database reach is four function
 * names, and that is the property that keeps a service-role key from being a
 * general-purpose bypass of the layer this project's bugs come from. If a
 * future change here wants a table, it wants an RPC instead.
 *
 * **The bare grep prints 2 and both are this sentence** — `CLAUDE.md`'s comment
 * trap, in the file whose whole safety argument rests on the count. Keep the
 * second half of the pipe, and note the anchor: `grep -rn` over a directory
 * prints `path:line:`, but `grep -n` on ONE file prints `line:` with no path,
 * so `CLAUDE.md`'s `:[0-9]+:` pattern matches nothing here and silently reports
 * the unfiltered number. Measured: it did, on the first version of this very
 * comment.
 *
 *   grep -n "\.from(" supabase/functions/push-notify/index.ts | grep -vcE '^[0-9]+: *\*'
 *
 * `src/__tests__/no-service-role-key.test.ts` asserts it on comment-stripped
 * source and verifies the filter both ways.
 *
 * ---------------------------------------------------------------------------
 * What it does NOT decide, and the shape that follows from it
 * ---------------------------------------------------------------------------
 * **What may leave the database is decided in SQL, by `push_payload_for`, per
 * COLUMN.** This file never asks for a subject; it asks for a notification's
 * payload and is either given one or not. A gate refusal is an EMPTY RESULT
 * rather than an error, which is why the sweep below reads zero rows as
 * `suppressed` and not as a failure — and why it can never widen what it was
 * given, because there is no argument here that would widen anything.
 *
 * **Two calls, not one, and the second is per notification.** `claim_push_batch`
 * returns the outbox row crossed with every device it fans out to; the copy
 * comes from `push_payload_for`, once per notification however many phones the
 * rider has. So the loop is over DELIVERIES and the inner fan-out is over
 * devices — which is also the unit `complete_push_delivery` takes, since it
 * records one verdict per outbox row and a list of the installations that
 * actually took the push.
 *
 * **The retry bound is the SQL's.** `complete_push_delivery` counts attempts
 * and turns `retry` into `failed` after five. An earlier draft of this function
 * carried its own attempt counter and backoff table — two bounds that can
 * disagree, deleted. This file reports an outcome; the row's next state is not
 * its business.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  BATCH_SIZE,
  SEND_CONCURRENCY,
  classifyApnsOutcome,
  classifyFcmOutcome,
  classifyPayloadError,
  fcmErrorNamesToken,
  groupByDelivery,
  mapWithConcurrency,
  resolveDeliveryOutcome,
  toApnsPayload,
  toFcmMessage,
  type PushClaimRow,
  type PushDelivery,
  type PushOutcome,
  type PushPayload,
} from './shape.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

/**
 * APNs. `APNS_HOST` is a secret rather than a build constant (design Q2): one
 * `.p8` per team works for both environments and only the HOST differs, so the
 * sandbox/production split is a per-project setting and not a code path. That
 * is also the second of the two independent guards that stop a DEV job ringing
 * a real rider's phone — the first is `121`'s Vault gate on the cron job.
 */
const APNS_KEY = Deno.env.get('APNS_KEY') ?? ''
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID') ?? ''
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') ?? ''
const APNS_HOST = Deno.env.get('APNS_HOST') ?? ''
const APNS_BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID') ?? ''

/** FCM. The whole service-account JSON, as downloaded, in one secret. */
const FCM_SERVICE_ACCOUNT = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? ''

type Json = Record<string, unknown>

function jsonResponse(body: Json, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Constant-time string comparison.
 *
 * A plain `===` on a secret leaks its prefix through timing. The cost here is
 * nil and the habit is the point: this is the one comparison in the repository
 * whose left side is a credential.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The caller check — rule 3, and it departs from design D11's wording on
 * purpose, in the direction of being stronger.
 *
 * D11 says *verify the JWT's signature, then require `role: service_role`*, and
 * it is right about what it was rejecting: a decode-only check that reads the
 * `role` claim without verifying anything is forgeable by anyone who can type,
 * because both Supabase keys are valid JWTs differing only in that claim.
 *
 * **What this does instead is require the caller to present the exact secret
 * this function holds.** That is not a weaker check than verifying a signature
 * and reading a claim, it is a strictly stronger one: a signature check admits
 * *any* token this project's secret signed with the right claim, and this
 * admits exactly one value. It is also the only version that survives the
 * current key format — `sb_secret_…` keys are not JWTs and have no signature to
 * verify, so a literal reading of D11 would have to be implemented against the
 * legacy format and would silently stop working on rotation.
 *
 * **`verify_jwt` is left ON at the gateway as an outer layer, and it is not
 * this check.** It admits any signed-in rider's access token. Do not read its
 * presence in the config as the caller being verified.
 */
function assertServiceRoleCaller(req: Request): Response | null {
  if (!SERVICE_ROLE_KEY) {
    // Fail closed, and say which secret is missing rather than 401ing the
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

// ---------------------------------------------------------------------------
// APNs
// ---------------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlJson(value: Json): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)))
}

/** Strip PEM armour and decode the body to DER. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  const der = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i)
  return der
}

/**
 * The APNs provider token: an ES256 JWT signed with the `.p8`.
 *
 * Cached for the life of the invocation only. Apple rejects a provider token
 * refreshed more often than once per 20 minutes AND one older than 60 minutes,
 * so the safe thing for a function that runs for seconds is to mint one per
 * invocation and never store it — a cache across invocations would need to
 * respect both bounds and there is nowhere here to keep it that is not worse
 * than re-signing.
 */
async function mintApnsToken(): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(APNS_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = base64urlJson({ alg: 'ES256', kid: APNS_KEY_ID })
  const claims = base64urlJson({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })
  const signingInput = `${header}.${claims}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${base64url(new Uint8Array(signature))}`
}

async function sendApns(
  device: PushClaimRow,
  payload: PushPayload,
  providerToken: string,
): Promise<PushOutcome> {
  try {
    const response = await fetch(`https://${APNS_HOST}/3/device/${device.token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${providerToken}`,
        'apns-topic': APNS_BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        // A retry of the same notification replaces the earlier attempt rather
        // than stacking a duplicate on the lock screen.
        'apns-collapse-id': device.notification_id.slice(0, 64),
      },
      body: JSON.stringify(toApnsPayload(payload)),
    })

    if (response.status === 200) return classifyApnsOutcome(200)

    // A body is present on every APNs error, but a truncated or non-JSON one is
    // possible on a gateway failure — and reading `reason` as undefined then
    // routes to `transport`, which is the safe direction.
    let reason: string | null = null
    try {
      const body = (await response.json()) as { reason?: string }
      reason = body?.reason ?? null
    } catch {
      reason = null
    }
    return classifyApnsOutcome(response.status, reason)
  } catch {
    // A thrown fetch is a network failure, never a statement about the device.
    return 'transport'
  }
}

// ---------------------------------------------------------------------------
// FCM v1
// ---------------------------------------------------------------------------

type ServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

function readServiceAccount(): ServiceAccount {
  return JSON.parse(FCM_SERVICE_ACCOUNT) as ServiceAccount
}

/**
 * Exchange the service account for an OAuth access token (RS256 assertion).
 *
 * One per invocation, like the APNs token and for the same reason: the lifetime
 * is an hour, the invocation is seconds, and there is no store here worth the
 * complexity of respecting an expiry in.
 */
async function mintFcmAccessToken(account: ServiceAccount): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token'
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' })
  const claims = base64urlJson({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })
  const signingInput = `${header}.${claims}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  )
  const assertion = `${signingInput}.${base64url(new Uint8Array(signature))}`

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) throw new Error(`fcm_oauth_${response.status}`)
  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error('fcm_oauth_no_token')
  return body.access_token
}

async function sendFcm(
  device: PushClaimRow,
  payload: PushPayload,
  accessToken: string,
  projectId: string,
): Promise<PushOutcome> {
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toFcmMessage(payload, device.token)),
      },
    )

    if (response.status === 200) return classifyFcmOutcome(200)

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    const errorStatus =
      typeof body === 'object' && body !== null
        ? ((body as { error?: { status?: string } }).error?.status ?? null)
        : null

    // `fcmErrorNamesToken` is what stops an INVALID_ARGUMENT about OUR payload
    // being read as a dead device token — see `shape.ts`.
    return classifyFcmOutcome(response.status, errorStatus, fcmErrorNamesToken(body))
  } catch {
    return 'transport'
  }
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------


Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const refusal = assertServiceRoleCaller(req)
  if (refusal) return refusal

  // The service-role client. It is used for `.rpc()` and nothing else — rule 5.
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: claimed, error: claimError } = await db.rpc('claim_push_batch', {
    batch_size: BATCH_SIZE,
  })
  if (claimError) {
    return jsonResponse({ error: 'claim_failed', detail: claimError.message }, 500)
  }

  const rows = (claimed ?? []) as PushClaimRow[]
  // An empty outbox is the ordinary case on most ticks. Nothing to report and
  // nothing went wrong.
  if (rows.length === 0) return jsonResponse({ deliveries: 0 }, 200)

  const deliveries = groupByDelivery(rows)

  /**
   * Mint each provider credential at most once, and only when that platform
   * actually appears in the batch.
   *
   * **The placement is the point.** A mint failure is the outage case — a bad
   * `.p8`, an expired service account, Google's OAuth endpoint down — and it
   * affects every device on that platform at once. Inside the per-device loop
   * its failure is indistinguishable from a per-device one, which is precisely
   * how a platform outage would unsubscribe every rider on it. Out here it can
   * only ever produce `transport`, which never deletes a token.
   */
  const platforms = new Set(rows.map((row) => row.platform))

  let apnsToken: string | null = null
  if (platforms.has('ios')) {
    try {
      apnsToken = await mintApnsToken()
    } catch {
      apnsToken = null
    }
  }

  let fcmToken: string | null = null
  let fcmProjectId = ''
  if (platforms.has('android')) {
    try {
      const account = readServiceAccount()
      fcmProjectId = account.project_id
      fcmToken = await mintFcmAccessToken(account)
    } catch {
      fcmToken = null
    }
  }

  /**
   * Read into consts before the branch rather than narrowing the outer `let`
   * in place. Nothing in this container type-checks this file — CI's `deno
   * check` is its first — so the cheap insurance is worth more than the two
   * lines it costs.
   */
  const apns = apnsToken
  const fcm = fcmToken
  const fcmProject = fcmProjectId

  async function sendToDevice(
    device: PushClaimRow,
    payload: PushPayload,
  ): Promise<PushOutcome> {
    if (device.platform === 'ios') {
      return apns ? await sendApns(device, payload, apns) : 'transport'
    }
    if (device.platform === 'android') {
      return fcm ? await sendFcm(device, payload, fcm, fcmProject) : 'transport'
    }
    // An unknown platform is a registration bug, not a dead device. `transport`
    // retries it harmlessly rather than deleting a row nobody has diagnosed.
    return 'transport'
  }

  const counts = { sent: 0, suppressed: 0, retry: 0, failed: 0, devicesInvalidated: 0 }

  /**
   * `mapWithConcurrency` abandons a lane whose worker throws, and a rejected
   * `Promise.all` would drop the rest of the batch while the counts still read
   * as success. So this worker never throws: every path resolves.
   */
  await mapWithConcurrency(deliveries, SEND_CONCURRENCY, async (delivery: PushDelivery) => {
    try {
      const { data: payloadRows, error: payloadError } = await db.rpc('push_payload_for', {
        notification_id: delivery.notificationId,
      })

      /**
       * An error is not a refusal — a refusal is zero rows, handled below.
       * `classifyPayloadError` splits our own `23514` (unknown type, NULL copy)
       * from everything transient; see `shape.ts` for why the default retries.
       */
      if (payloadError) {
        const outcome = classifyPayloadError(payloadError.code)
        await db.rpc('complete_push_delivery', {
          delivery_id: delivery.deliveryId,
          outcome,
          delivered_installations: [],
        })
        counts[outcome]++
        return
      }

      const payload = ((payloadRows ?? []) as PushPayload[])[0] ?? null

      /**
       * The gate refused, so there is nothing to send and never will be —
       * `suppressed`, which `complete_push_delivery` never retries. This is the
       * block, the left club, the deleted postcard: the recipient is no longer
       * entitled to the content, and the in-app row is gone too.
       */
      if (!payload) {
        await db.rpc('complete_push_delivery', {
          delivery_id: delivery.deliveryId,
          outcome: 'suppressed',
          delivered_installations: [],
        })
        counts.suppressed++
        return
      }

      const results: { installation_id: string; outcome: PushOutcome }[] = []
      for (const device of delivery.devices) {
        results.push({
          installation_id: device.installation_id,
          outcome: await sendToDevice(device, payload),
        })
      }

      const verdict = resolveDeliveryOutcome(results)

      /**
       * Dead devices go first. If this succeeds and the completion below fails,
       * the row is reclaimed and retried against a device that no longer
       * exists — a no-op. The other order leaves a dead token receiving nothing
       * for ever while the row reads `sent`.
       */
      for (const installationId of verdict.deadInstallations) {
        await db.rpc('invalidate_push_device', { installation_id: installationId })
        counts.devicesInvalidated++
      }

      await db.rpc('complete_push_delivery', {
        delivery_id: delivery.deliveryId,
        outcome: verdict.outcome,
        delivered_installations: verdict.deliveredInstallations,
      })
      counts[verdict.outcome]++
    } catch {
      /**
       * Leaving the row `claimed` is the safe failure: `claim_push_batch`'s
       * reclaim window puts it back in a later sweep. Throwing here would take
       * the rest of this lane's deliveries with it.
       */
    }
  })

  return jsonResponse({ deliveries: deliveries.length, devices: rows.length, ...counts }, 200)
})
