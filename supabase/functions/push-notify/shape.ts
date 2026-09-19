/**
 * push-notify/shape.ts — every decision the push sender makes, with no Deno
 * global and no `jsr:` import in the file.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS SEPARATELY FROM `index.ts`
 * ---------------------------------------------------------------------------
 * `tsconfig.json` excludes `supabase/functions`, so `npx tsc --noEmit` does not
 * see the sibling `index.ts`, and neither does Vitest or `next build`. That is
 * `delete-account`'s rule 4, and `search-places` answered it by putting the
 * decisions in a `shape.ts` that a unit test under `src/__tests__/` imports —
 * which drags the file back inside `tsc`'s graph and Vitest's. This file copies
 * that split for the same reason, and `src/__tests__/push-notify-shape.test.ts`
 * is the test that keeps it honest.
 *
 * **Keep the split.** Anything here that grows a `Deno.` reference or a `jsr:`
 * import silently drops out of both tools, and nothing goes red when it does.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DECIDE
 * ---------------------------------------------------------------------------
 * **Two things live in `121` and must not be re-implemented here**, because a
 * second copy is a second thing that can drift:
 *
 * 1. **What may leave the database.** `push_payload_for` runs the visibility
 *    gate per column and returns nothing when it refuses. This file never sees
 *    a row the gate rejected and has no way to ask for one.
 * 2. **The retry bound.** `complete_push_delivery` counts attempts and turns
 *    `retry` into `failed` after five. An earlier draft of this file carried
 *    its own `MAX_ATTEMPTS` and a backoff table, which is exactly the
 *    two-bounds-that-disagree shape — deleted. This file reports an OUTCOME and
 *    the SQL decides what the row becomes.
 *
 * ---------------------------------------------------------------------------
 * THE CLASSIFIER IS THE THING MOST LIKELY TO BE WRONG
 * ---------------------------------------------------------------------------
 * Task 3.16 says so, and this repo has the worked example of getting one wrong:
 * `search-places`'s `isPolicyRefusal` matched `42501` only, `069`'s gate raises
 * `23514`, and a refusal fell to the outage branch (PD-276). The same mistake
 * here is worse and quieter.
 *
 * **A transport error must never delete a token.** Folding one into the
 * `device_gone` branch unsubscribes every rider on whichever platform is having
 * an outage — an APNs 503 or an FCM 500 arrives for every token at once — and
 * nothing reports it, because from the database's point of view the tokens were
 * legitimately retired. The rider finds out weeks later by noticing they get
 * nothing. So `transport` is the DEFAULT and `device_gone` is the narrow,
 * explicitly enumerated case, never the other way round.
 */

/**
 * What one delivery attempt to one device turned out to be.
 *
 * Three outcomes rather than a boolean, because the two failures want opposite
 * handling: `device_gone` is the only one that may reach
 * `invalidate_push_device`, and `transport` is the only one that may be
 * retried.
 */
export type PushOutcome = 'delivered' | 'device_gone' | 'transport'

/**
 * The APNs reasons that mean *this token is dead*, and nothing else does.
 *
 * `Unregistered` (410): the app was deleted or the token reissued.
 * `BadDeviceToken` (400): not a valid token for this environment at all, which
 * includes the ordinary sandbox/production mix-up — a real reason to drop it,
 * since a production token will never be deliverable from the sandbox host.
 * `DeviceTokenNotForTopic` (400): the token belongs to another bundle id, so it
 * is dead *for us* however healthy it is for someone else.
 *
 * **`ExpiredProviderToken`, `InvalidProviderToken` and `MissingProviderToken`
 * are deliberately NOT here.** They are 403s about OUR signing key, not about
 * the device — the most tempting wrong entry on this list, because the word
 * "token" appears in both and the 403 arrives for every device at once.
 */
const APNS_DEAD_TOKEN_REASONS = new Set([
  'Unregistered',
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
])

export function classifyApnsOutcome(status: number, reason?: string | null): PushOutcome {
  if (status === 200) return 'delivered'
  // A 410 with a body we failed to parse is still an unambiguous "gone".
  if (status === 410) return 'device_gone'
  if (status === 400 && reason && APNS_DEAD_TOKEN_REASONS.has(reason)) return 'device_gone'
  // 403 (our key), 404, 405, 413, 429, 500, 503 and anything unrecognised.
  return 'transport'
}

/**
 * Classify one FCM v1 response.
 *
 * `UNREGISTERED` / `NOT_FOUND` is the clean case: the token is dead.
 *
 * **`INVALID_ARGUMENT` is the trap**, and the FCM-shaped version of exactly the
 * mistake task 3.16 warns about. FCM returns it both for a malformed
 * registration token — genuinely dead — and for a malformed *message*, which is
 * our own payload bug, and those arrive identically at the HTTP layer. Treating
 * the whole status as `device_gone` means the first time someone ships a bad
 * field, every token in the batch is deleted, one per rider, and the sender
 * reports success. So it counts as a dead token only when the error detail
 * actually names the token field; otherwise `transport`, which retries, fails
 * loudly and changes nothing.
 */
export function classifyFcmOutcome(
  status: number,
  errorStatus?: string | null,
  namesToken = false,
): PushOutcome {
  if (status === 200) return 'delivered'
  if (status === 404 || errorStatus === 'NOT_FOUND' || errorStatus === 'UNREGISTERED') {
    return 'device_gone'
  }
  if (errorStatus === 'INVALID_ARGUMENT') return namesToken ? 'device_gone' : 'transport'
  // UNAUTHENTICATED / PERMISSION_DENIED (our service account), RESOURCE_EXHAUSTED,
  // UNAVAILABLE, INTERNAL, and anything unrecognised.
  return 'transport'
}

/**
 * Does an FCM error body point at the registration token rather than the
 * message?
 *
 * FCM v1 reports the offending field in
 * `error.details[].fieldViolations[].field`. A violation naming `message.token`
 * is a dead token; one naming any other field is our payload. Unparseable or
 * absent details answer `false`, which routes to `transport` — the safe
 * direction. Typed against `unknown` because the only thing this may assume
 * about that body is the one path it reads.
 */
export function fcmErrorNamesToken(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return false
  const details = (error as { details?: unknown }).details
  if (!Array.isArray(details)) return false

  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue
    const violations = (detail as { fieldViolations?: unknown }).fieldViolations
    if (!Array.isArray(violations)) continue
    for (const violation of violations) {
      if (typeof violation !== 'object' || violation === null) continue
      const field = (violation as { field?: unknown }).field
      if (typeof field === 'string' && /(^|\.)token$/.test(field)) return true
    }
  }
  return false
}

/**
 * How many outbox rows one invocation claims.
 *
 * `event-fanout-integrity`'s requirement is that a fan-out is *bounded and not
 * assumed small*. The bound lives here rather than as the SQL default so the
 * two cannot disagree: `claim_push_batch` takes it as an argument.
 */
export const BATCH_SIZE = 200

/**
 * How many devices are written to at once.
 *
 * **Sequential was the first version and it is a timeout, not a style
 * preference.** Each device costs a provider request, and each delivery one or
 * two RPCs on top; a full batch sequentially is well over a minute of wall time
 * for work the scheduler expects inside its one-minute interval. A latency
 * spike then kills the invocation halfway, leaving rows `claimed` with no
 * completion.
 *
 * **What happens to those rows is `claim_push_batch`'s reclaim, and an earlier
 * version of this comment said it was the age cut, which was wrong** —
 * `reviewer` finding 1, 2026-09-19. The age cut is evaluated inside the
 * `pending` candidate set, so it never sees a `claimed` row; before the reclaim
 * existed, such a row was never delivered and never swept, which is silent loss
 * plus an immortal row. Do not re-describe this as the age cut: the two comments
 * that did are exactly why nobody looked again.
 *
 * Ten rather than "all of them" because both providers rate-limit, and a burst
 * of 200 is the shape that earns a 429 — correctly read as `transport`, so no
 * token is lost, but the batch achieves nothing.
 */
export const SEND_CONCURRENCY = 10

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * A worker that throws abandons the remaining items in its lane, so the
 * contract is that `worker` handles its own failures. `index.ts` satisfies that
 * by resolving every error into a `PushOutcome`; stated here because the
 * alternative — a `Promise.all` that rejects — silently drops the rest of the
 * batch and looks like a quiet success in the counts.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, Math.floor(limit))
  let cursor = 0
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(lanes)
}

/** One row of `claim_push_batch`: an outbox row paired with one device. */
export type PushClaimRow = {
  delivery_id: string
  notification_id: string
  recipient_id: string
  /**
   * The device's stable key, and the argument `invalidate_push_device` takes.
   *
   * **Not the token**, even though the token is what the provider refused.
   * `push_devices` is `unique (installation_id)` — design D3, which chose that
   * over `unique (user_id, token)` because the second keeps two live rows for a
   * shared phone — so the installation identifies the row and the token is a
   * value that moves underneath it. Invalidating by token races a
   * re-registration.
   */
  installation_id: string
  token: string
  platform: string
}

/** The single row `push_payload_for` returns, or nothing when the gate refuses. */
export type PushPayload = {
  id: string
  recipient_id: string
  type: string
  title: string
  body: string
  postcard_id: string | null
  comment_id: string | null
  ride_id: string | null
  club_id: string | null
  thread_id: string | null
}

/**
 * One outbox row with every device it fans out to.
 *
 * `claim_push_batch` returns the cross product, because a notification with
 * three devices is three sends and one completion. Grouping restores the unit
 * `complete_push_delivery` actually takes.
 */
export type PushDelivery = {
  deliveryId: string
  notificationId: string
  recipientId: string
  devices: PushClaimRow[]
}

export function groupByDelivery(rows: PushClaimRow[]): PushDelivery[] {
  const byDelivery = new Map<string, PushDelivery>()
  for (const row of rows) {
    const existing = byDelivery.get(row.delivery_id)
    if (existing) {
      existing.devices.push(row)
      continue
    }
    byDelivery.set(row.delivery_id, {
      deliveryId: row.delivery_id,
      notificationId: row.notification_id,
      recipientId: row.recipient_id,
      devices: [row],
    })
  }
  return [...byDelivery.values()]
}

/**
 * The in-app destination for a notification, as a path the shell can open.
 *
 * **This duplicates `src/lib/routes.ts` and cannot import it.** That file lives
 * under `src/` behind the `@/` alias, which Deno does not resolve, and pulling
 * it in would also drag Next's module graph into an Edge Function. The
 * duplication is pinned rather than trusted:
 * `src/__tests__/push-notify-shape.test.ts` imports the real `routes` helper
 * and asserts this function agrees with it for every type — so a change to the
 * detail-route shape reds the suite here rather than silently shipping pushes
 * that open the wrong screen, or nothing.
 *
 * `null` means *no destination*, which is a real answer rather than a failure:
 * the push is still worth sending and the shell opens the app.
 */
export function pathForPayload(payload: PushPayload): string | null {
  const detail = (path: string, id: string) => `${path}?id=${encodeURIComponent(id)}`

  switch (payload.type) {
    case 'postcard_liked':
    case 'postcard_commented':
      return payload.postcard_id ? detail('/postcards/detail', payload.postcard_id) : null

    case 'ride_joined':
    case 'ride_created_in_club':
    case 'ride_invited':
    case 'ride_invite_accepted':
    case 'ride_invite_declined':
      return payload.ride_id ? detail('/rides/detail', payload.ride_id) : null

    case 'club_joined':
    case 'club_waved':
    case 'club_join_request_approved':
    case 'club_join_request_declined':
    case 'club_invited':
    case 'club_invite_declined':
      return payload.club_id ? detail('/clubs/detail', payload.club_id) : null

    // The owner's or admin's roster, not the club's front page — the thing they
    // are being told about is a pending request, which is only actionable there.
    case 'club_join_requested':
      return payload.club_id ? detail('/clubs/detail/manage', payload.club_id) : null

    // Takes the THREAD's id, not the club's.
    case 'club_thread_replied':
    case 'club_thread_waved':
      return payload.thread_id ? detail('/clubs/detail/thread', payload.thread_id) : null

    default:
      return null
  }
}

/**
 * The APNs payload.
 *
 * `content-available` is deliberately absent: this is a visible alert, and a
 * payload carrying both an alert and a background flag is delivered at
 * background priority on iOS, which is the quiet way a push stops arriving
 * promptly.
 *
 * **`thread-id` is absent too, and that is a decision rather than an
 * omission.** It groups notifications in Notification Center, and the only
 * stable value here is the notification's own id — unique per row, so grouping
 * by it is identical to not grouping. A field that reads as grouping and never
 * groups is worse than no field.
 */
export function toApnsPayload(payload: PushPayload): Record<string, unknown> {
  const path = pathForPayload(payload)
  return {
    aps: { alert: { title: payload.title, body: payload.body }, sound: 'default' },
    ...(path ? { path } : {}),
  }
}

/**
 * The FCM v1 message.
 *
 * Wrapped in `{ message: … }` because that is the v1 request envelope; the
 * legacy API's flat shape is a 400 here and reads like a payload bug rather
 * than a versioning one. `data` values must be strings — FCM rejects a number —
 * which is the kind of detail that produces exactly the `INVALID_ARGUMENT`
 * `classifyFcmOutcome` refuses to read as a dead token.
 */
export function toFcmMessage(payload: PushPayload, token: string): Record<string, unknown> {
  const path = pathForPayload(payload)
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: { notificationId: payload.id, ...(path ? { path } : {}) },
      android: { priority: 'HIGH' },
    },
  }
}

/** The outcomes `complete_push_delivery` accepts. */
export type DeliveryOutcome = 'sent' | 'suppressed' | 'retry' | 'failed'

/**
 * What a failed `push_payload_for` call means for the outbox row.
 *
 * **Three outcomes hide behind one call and conflating any two is a real
 * defect**, which is `search-places`'s `classifyLedgerError` one function
 * along — there, `isPolicyRefusal` matched `42501` only, the gate raised
 * `23514`, and a refusal fell to the outage branch (PD-276).
 *
 * - **Zero rows is a REFUSAL**, not an error, and never reaches this function.
 *   The visibility gate declined: the recipient is blocked, left the private
 *   club, or the subject is gone. That is `suppressed` and is terminal.
 * - **`23514` (check_violation) is OUR bug** — an unknown notification type, or
 *   NULL copy — raised deliberately by `push_payload_for`'s `else` arm so it
 *   cannot return a push with no words on it. Retrying re-raises it every
 *   minute until the age cut, so it is `failed`: terminal, and visible in the
 *   table as a failure rather than buried as a suppression.
 * - **Anything else is transport** — a dropped connection, a statement timeout,
 *   the pooler restarting. `retry`, because we do not know.
 *
 * The direction of the default matters: an unrecognised code retries, which
 * costs a few attempts and then `failed`. Defaulting to `failed` would make one
 * transient pooler blip permanently drop a notification the rider was entitled
 * to.
 */
export function classifyPayloadError(code?: string | null): 'failed' | 'retry' {
  return code === '23514' ? 'failed' : 'retry'
}

/**
 * Turn a delivery's per-device outcomes into the one verdict the SQL takes.
 *
 * - **Any device delivered → `sent`.** A rider with three phones who got it on
 *   one has been notified.
 * - **No delivery, and every failure was `device_gone` → `sent`.** A dead token
 *   is not a failed delivery: the notification was correctly addressed and
 *   there is nothing further to do with it. `failed` would make an ordinary app
 *   deletion indistinguishable from an outage in every count built on this
 *   table, and `retry` would re-send to a device that is gone.
 * - **Any `transport` failure → `retry`.** The SQL bounds it to five attempts
 *   and then writes `failed` itself; this file does not count attempts.
 * - **No devices at all → `sent`.** Task 3.10h: a recipient with zero tokens
 *   completes rather than fails. There is nothing to retry, ever.
 *
 * `deadInstallations` is what reaches `invalidate_push_device`, and it holds
 * `device_gone` and nothing else — the property the whole classifier exists to
 * protect.
 */
export function resolveDeliveryOutcome(
  devices: { installation_id: string; outcome: PushOutcome }[],
): {
  outcome: DeliveryOutcome
  deliveredInstallations: string[]
  deadInstallations: string[]
} {
  const deliveredInstallations = devices
    .filter((d) => d.outcome === 'delivered')
    .map((d) => d.installation_id)
  const deadInstallations = devices
    .filter((d) => d.outcome === 'device_gone')
    .map((d) => d.installation_id)
  const anyTransport = devices.some((d) => d.outcome === 'transport')

  const outcome: DeliveryOutcome =
    deliveredInstallations.length > 0 ? 'sent' : anyTransport ? 'retry' : 'sent'

  return { outcome, deliveredInstallations, deadInstallations }
}
