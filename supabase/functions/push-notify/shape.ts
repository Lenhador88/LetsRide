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
 * import silently drops out of both tools, and nothing goes red when it does —
 * the test simply stops being able to import the file, which is a failure, but a
 * decision moved the other way (into `index.ts`) fails nothing at all.
 *
 * ---------------------------------------------------------------------------
 * THE CLASSIFIER IS THE THING MOST LIKELY TO BE WRONG
 * ---------------------------------------------------------------------------
 * Task 3.16 says so in as many words, and this repo already has the worked
 * example of getting one wrong: `search-places`'s `isPolicyRefusal` matched
 * `42501` only, `069`'s participation gate raises `23514`, and a refusal fell to
 * the outage branch (PD-276). The same mistake here is worse and quieter.
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
 * What one delivery attempt to one token turned out to be.
 *
 * Three outcomes rather than a boolean, because the two failures want opposite
 * handling: `device_gone` is the only one that may remove a device row
 * (`invalidate_push_device`), and `transport` is the only one that may be
 * retried.
 */
export type PushOutcome = 'delivered' | 'device_gone' | 'transport'

/**
 * The APNs reasons that mean *this token is dead*, and nothing else does.
 *
 * `Unregistered` (410) is the documented one: the app was deleted, or the token
 * was reissued. `BadDeviceToken` (400) means the token is not a valid token for
 * this environment at all — which includes the ordinary sandbox/production
 * mix-up, and that is a real reason to drop it: a production token in the
 * sandbox will never be deliverable from this host.
 *
 * `DeviceTokenNotForTopic` (400) is the third and it is the one worth naming
 * explicitly rather than letting it fall through: the token belongs to a
 * different bundle id, so it is dead *for us* however healthy it is for someone
 * else.
 *
 * **`ExpiredProviderToken`, `InvalidProviderToken` and `MissingProviderToken`
 * are deliberately NOT here.** They are 403s about OUR signing key, not about
 * the device — the single most tempting wrong entry on this list, because the
 * word "token" appears in both and the 403 arrives for every device at once.
 */
const APNS_DEAD_TOKEN_REASONS = new Set([
  'Unregistered',
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
])

/**
 * Classify one APNs response.
 *
 * @param status the HTTP status APNs returned
 * @param reason the `reason` field of APNs' JSON body, when it sent one
 */
export function classifyApnsOutcome(status: number, reason?: string | null): PushOutcome {
  if (status === 200) return 'delivered'

  // 410 carries `Unregistered`, but treat the status as sufficient on its own:
  // a 410 with a body we failed to parse is still an unambiguous "gone".
  if (status === 410) return 'device_gone'

  if (status === 400 && reason && APNS_DEAD_TOKEN_REASONS.has(reason)) return 'device_gone'

  // 403 (our key), 404, 405, 413, 429, 500, 503 and anything unrecognised.
  return 'transport'
}

/**
 * Classify one FCM v1 response.
 *
 * @param status the HTTP status
 * @param errorStatus the `error.status` field of FCM's JSON body (`NOT_FOUND`,
 *   `INVALID_ARGUMENT`, `UNAVAILABLE`, …)
 * @param namesToken whether FCM's error details point at the registration
 *   token field rather than at the message. See below — this argument is the
 *   whole reason this function is not three lines.
 *
 * `UNREGISTERED` / `NOT_FOUND` is the clean case: the token is dead.
 *
 * **`INVALID_ARGUMENT` is the trap, and it is the FCM-shaped version of exactly
 * the mistake task 3.16 warns about.** FCM returns it both for a malformed
 * registration token — genuinely dead — and for a malformed *message*, which is
 * our own payload bug. Those arrive identically at the HTTP layer. Treating the
 * whole status as `device_gone` means the first time someone ships a bad payload
 * field, every token in the batch is deleted, one per rider, and the sender
 * reports success. So an `INVALID_ARGUMENT` counts as a dead token only when the
 * error detail actually names the token field; otherwise it is `transport`,
 * which retries, fails loudly and changes nothing.
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

  if (errorStatus === 'INVALID_ARGUMENT') {
    return namesToken ? 'device_gone' : 'transport'
  }

  // UNAUTHENTICATED / PERMISSION_DENIED (our service account), RESOURCE_EXHAUSTED,
  // UNAVAILABLE, INTERNAL, and anything unrecognised.
  return 'transport'
}

/**
 * Does an FCM error body point at the registration token rather than at the
 * message?
 *
 * FCM v1 reports the offending field in `error.details[].fieldViolations[].field`
 * for a `BAD_REQUEST` detail. A violation naming `message.token` is a dead
 * token; one naming any other field is our payload. Unparseable or absent
 * details answer `false`, which routes to `transport` — the safe direction.
 *
 * Typed against `unknown` rather than a hand-written FCM response type because
 * the only thing this may assume about that body is the one path it reads.
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
 * assumed small*. The bound lives here rather than in the SQL default so the two
 * cannot disagree: `claim_push_batch` takes it as an argument.
 *
 * Sized against the one-minute interval (design Q1's default): a batch that
 * cannot be sent inside the interval makes the next invocation overlap the
 * current one, which `claim_push_batch`'s `for update skip locked` makes safe
 * but pointless. 200 rows against two providers is comfortably inside a minute.
 */
export const BATCH_SIZE = 200

/**
 * How many times a `transport` outcome is retried before the row is given up on.
 *
 * Bounded because `push_deliveries` is a queue and an unbounded retry makes a
 * provider outage into a table that never drains. Four attempts across the
 * backoff below spans roughly fifteen minutes, after which a notification is
 * stale enough that `claim_push_batch`'s age cut would have suppressed it anyway.
 */
export const MAX_ATTEMPTS = 4

/**
 * Backoff before the next attempt, in milliseconds.
 *
 * This is *not* slept inside the invocation — a function that sleeps holds a
 * batch open and burns wall time the scheduler has already accounted for.
 * It is written onto the row as the earliest time the next sweep may reclaim it,
 * so the retry costs nothing until it is due.
 *
 * Exponential from one minute, capped: 1m, 2m, 4m, 8m.
 */
export function backoffMs(attempt: number): number {
  const clamped = Math.max(1, Math.min(attempt, MAX_ATTEMPTS))
  return 60_000 * 2 ** (clamped - 1)
}

/**
 * Whether a `transport` failure on this attempt is the last one.
 *
 * Kept as a named predicate rather than inlined at the call site because the
 * off-by-one here decides whether a row is retried four times or five, and a
 * bare `>=` in the middle of the send loop is where that goes wrong unnoticed.
 */
export function isFinalAttempt(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS
}

/**
 * One row of `claim_push_batch`'s result: a notification that is due, its
 * rendered copy, and one device to send it to.
 *
 * **There is no subject id, no club name and no ride title beyond what `title`
 * and `body` already render.** The gate in `push_payload_for` decided what may
 * leave the database; by the time a row reaches this file that decision is made,
 * and re-deriving anything from an id here would be a second, ungated read path.
 * That is why the shape carries strings rather than references.
 */
export type PushClaim = {
  deliveryId: string
  notificationId: string
  attempts: number
  platform: 'ios' | 'android'
  token: string
  title: string
  body: string
  /** Deep-link path inside the app, e.g. `/postcards/<id>`. Never a full URL. */
  path: string
}

/**
 * The APNs payload for one claim.
 *
 * `apns-topic` and the authorization header are `index.ts`'s — they are request
 * headers, not payload, and one of them is a secret.
 *
 * `content-available` is deliberately absent: this is a visible alert, and a
 * payload carrying both an alert and a background flag is delivered at the
 * background priority on iOS, which is the quiet way a push stops arriving
 * promptly.
 */
export function toApnsPayload(claim: PushClaim): Record<string, unknown> {
  return {
    aps: {
      alert: { title: claim.title, body: claim.body },
      sound: 'default',
      'thread-id': claim.notificationId,
    },
    path: claim.path,
  }
}

/**
 * The FCM v1 message for one claim.
 *
 * Wrapped in `{ message: … }` because that is the v1 request envelope; the
 * legacy API's flat shape is a 400 here and looks like a payload bug rather than
 * a versioning one.
 *
 * `data` values must be strings — FCM rejects a number — which is the kind of
 * detail that produces exactly the `INVALID_ARGUMENT` that
 * `classifyFcmOutcome` refuses to read as a dead token.
 */
export function toFcmMessage(claim: PushClaim): Record<string, unknown> {
  return {
    message: {
      token: claim.token,
      notification: { title: claim.title, body: claim.body },
      data: { path: claim.path, notificationId: claim.notificationId },
      android: { priority: 'HIGH' },
    },
  }
}

/**
 * Split a batch into per-platform groups, preserving order within each.
 *
 * Exists so `index.ts` makes one provider decision per group rather than one per
 * row, and so the "a recipient with zero tokens completes rather than fails"
 * case (task 3.10h) is visible as an empty group rather than as an exception
 * thrown halfway down a loop.
 */
export function groupByPlatform(claims: PushClaim[]): {
  ios: PushClaim[]
  android: PushClaim[]
} {
  const ios: PushClaim[] = []
  const android: PushClaim[] = []
  for (const claim of claims) {
    if (claim.platform === 'ios') ios.push(claim)
    else if (claim.platform === 'android') android.push(claim)
  }
  return { ios, android }
}

/**
 * The final state one claim's row should be written back with.
 *
 * Pure, so the state machine is testable without a provider: given an outcome
 * and the attempt number, what does the row become?
 *
 * - `delivered` → `sent`, terminal.
 * - `device_gone` → `sent` for the ROW and the *device* is invalidated
 *   separately. The row is not a failure: the notification was correctly
 *   addressed and there is nothing further to do with it. Marking it `failed`
 *   would make a normal app-deletion look like an outage in every count.
 * - `transport` → `pending` again while attempts remain, `failed` once they do
 *   not.
 */
export function nextDeliveryState(
  outcome: PushOutcome,
  attempt: number,
): { state: 'sent' | 'pending' | 'failed'; invalidateDevice: boolean; retryInMs: number | null } {
  if (outcome === 'delivered') {
    return { state: 'sent', invalidateDevice: false, retryInMs: null }
  }
  if (outcome === 'device_gone') {
    return { state: 'sent', invalidateDevice: true, retryInMs: null }
  }
  if (isFinalAttempt(attempt)) {
    return { state: 'failed', invalidateDevice: false, retryInMs: null }
  }
  return { state: 'pending', invalidateDevice: false, retryInMs: backoffMs(attempt) }
}
