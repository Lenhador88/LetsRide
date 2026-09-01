import posthog from 'posthog-js'

import type { AnalyticsEvent } from '@/lib/analytics/events'
import { scrubUrl } from '@/lib/observability/scrub'

/**
 * The one doorway to PostHog — PD-353.
 *
 * Same shape as `lib/data/`, `lib/actions/` and `lib/observability/`, and PD-353
 * asks for it by name: *"Every event goes through one thin module that owns
 * `capture`."* Nothing outside this directory imports `posthog-js`, and
 * `__tests__/analytics.test.ts` is what keeps that true.
 *
 * The reason is the same one that made the render migration a change to one
 * file: the privacy posture below — autocapture off, no ids in a URL, the
 * opt-out honoured before the first event — is a property of *this file*, and
 * only while every event goes through it.
 *
 * ## PostHog runs on PRODUCTION ONLY, and that is a hole this file has to cover
 *
 * The free tier allows one project, and a PostHog project is the analytics
 * boundary: a funnel aggregates everything in it by default, so a DEV event
 * corrupts a PROD number silently unless every insight remembers to filter it
 * out. So the key goes on Vercel's Production scope alone and is unset
 * everywhere else. That is the safe direction — no pollution is possible — and
 * it costs exactly what `CLAUDE.md` §Technology Decisions says a flag defaulting
 * off costs: **a thing nothing can reach is a thing nothing can test**.
 * `npm run walk` runs against DEV and cannot exercise one line of this.
 *
 * Two things cover it and PD-353 requires both:
 *
 * - **Unit-test the seam, not the transport.** Everything below is either pure
 *   or asserted through a fake `posthog`, and the four call sites are asserted
 *   to call `capture` with the right event and properties. That is the half
 *   that actually breaks.
 * - **Verify the transport once, by hand, on PROD**, after the promotion. It is
 *   a named step in the issue rather than an assumption, and it happens before
 *   the issue reaches `Done (in production)`.
 *
 * ## The pilot posture, and what retires it
 *
 * Product owner, 2026-08-31: **session replay ON and UNMASKED for the pilot**,
 * autocapture OFF, heatmaps OFF, web vitals ON. `CLAUDE.md` §Technology
 * Decisions requires anything provisional to carry the condition that ends it,
 * so: **the pilot ends when signup reaches riders nobody personally invited**,
 * with a numeric backstop of 50 completed profiles —
 * `select count(*) from profiles where onboarding_completed_at is not null`.
 * While the pilot group is people who can be *told*, unmasked recording is a
 * conversation; once it is strangers, it is not.
 *
 * **Passwords are masked whatever `maskAllInputs` says**, and that is worth
 * knowing rather than assuming: rrweb normalises `maskAllInputs: false` to
 * `{ password: true }`, so `input[type=password]` is never recorded. Measured
 * against the installed recorder rather than recalled, and asserted in
 * `__tests__/analytics.test.ts` so an SDK bump that changed it is red.
 *
 * ## The project setting and this config must agree, and nothing checks that
 *
 * Each of autocapture, heatmaps, replay and web vitals lives in two places — a
 * PostHog dashboard toggle and an option here — and the dashboard half is an
 * owner action outside this repo. A mismatch fails silently in the expensive
 * direction: autocapture switched on in the dashboard collects element text
 * from every screen while this file says it does not.
 */

/**
 * Written out rather than read through a variable, for the reason
 * `lib/observability/sentry.ts` gives at length: only a literal member
 * expression is inlined by the bundler, and `process.env[name]` compiles to a
 * runtime lookup that reads as "not configured" on every deployment.
 */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

export type AnalyticsStatus = 'initialised' | 'no-key' | 'already-initialised' | 'server'

let status: AnalyticsStatus | null = null

/**
 * The last rider handed to `identifyAnalyticsRider`, held until the SDK exists.
 *
 * Removes an ordering question rather than answering it. `writeSession` in
 * `guard-cache.ts` is the single place the current rider changes, and it can
 * fire before this module's effect has run — React effect order is a fact about
 * the tree, not a contract, and "the mount point is above the guard so its
 * effect runs first" is exactly the kind of reasoning that survives until
 * somebody moves a component. Buffering costs three lines and makes the answer
 * the same either way.
 */
let pendingRider: string | null | undefined

/**
 * The selector that keeps a meeting-point search out of the recording.
 *
 * **This is the one narrowing of "unmasked", and it is deliberate rather than
 * an oversight.** PD-353's own text expects the place search to stay masked
 * when the pilot posture is revisited, and `place_search_attempts` is the
 * standing decision it defers to: that table holds **no column that could store
 * the term**, on the ground that a meeting-point search is frequently a home
 * address. Recording the same keystrokes as video in a third-party store would
 * reinstate exactly what the schema was written to refuse, at higher fidelity
 * and with a different retention — and it would do so silently, because
 * nothing anywhere compares a replay setting against a schema decision.
 *
 * Everything else stays unmasked as asked. Undoing this is deleting one class
 * from one component.
 */
export const MASK_CLASS = 'ph-mask'

/**
 * `$current_url` and `$pathname` are the two properties PostHog puts on every
 * event, and both would carry the query string.
 *
 * That matters here more than it would in most apps: **every detail route in
 * this app carries its subject's id in `?id=`** — a postcard, a club, a ride,
 * i.e. other riders' content on a screen this rider merely had open. It is the
 * same rule `feedback.route` (`084`) and `lib/observability/scrub.ts` already
 * hold, and `scrubUrl` is imported rather than re-spelled so the three cannot
 * disagree about what a stripped URL is.
 *
 * It is applied in `before_send` rather than only at the call site because
 * PostHog sets these itself, on events this module never names — `$pageleave`,
 * web vitals, replay metadata.
 */
function stripIdsFromEvent<T extends { properties?: Record<string, unknown> } | null>(event: T): T {
  if (!event?.properties) return event
  for (const key of ['$current_url', '$pathname', '$referrer', '$initial_current_url']) {
    const value = event.properties[key]
    if (typeof value === 'string') event.properties[key] = scrubUrl(value)
  }
  return event
}

/**
 * The options object, separated from the call that consumes it so a test can
 * read it — the same split `buildSentryOptions` uses and for the same reason:
 * the transport is unreachable from every gate this repo has.
 */
export function buildPostHogOptions() {
  return {
    api_host: HOST,

    // **Capture-off until the rider's preference is known.** The preference
    // lives behind a round trip (`my_analytics_opt_out()`), so between page
    // load and that answer the SDK either captures or does not — and the
    // fail-closed direction is the one where the failure is *missing data*
    // rather than data from a rider who said no. `applyAnalyticsPreference`
    // opts in once the stamp reads NULL, and `opt_in_capturing` fires the
    // pageview then, so the first one is late rather than lost.
    opt_out_capturing_by_default: true,

    // PD-353: explicit events only. Autocapture's benefit is retroactive
    // questions — data already sitting there when you think of the question —
    // which accrues over a period with almost no riders, and it is the messiest
    // payload of the lot, collecting element text from every screen.
    autocapture: false,

    // Fired by hand instead — see `capturePageview`. Two reasons, and the
    // second is not in PD-353: this is a client-rendered SPA, so PostHog's
    // document-load pageview misses every navigation after the first; and its
    // automatic `$current_url` carries the `?id=` this app puts on every detail
    // route.
    capture_pageview: false as const,

    // An aggregate view whose value scales WITH traffic, which is the inverse
    // of replay's — and unmasked replay already shows where a rider taps.
    // Revisit at volume.
    enable_heatmaps: false,

    // Four numbers per pageview with no rider content in them, so no masking or
    // consent question. PD-217 and PD-218 are the argument: both were cold-load
    // layout jumps (~104px and ~52px) found by hand, i.e. CLS defects nothing
    // was measuring. `network_timing` is off because it collects request URLs,
    // which is the `?id=` problem again by another route.
    capture_performance: { web_vitals: true, network_timing: false },

    // The pilot posture. `maskAllInputs: false` is what "unmasked" means;
    // password inputs are masked regardless by rrweb, and `MASK_CLASS` is the
    // one narrowing — see its own comment.
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: false,
      maskTextClass: MASK_CLASS,
      maskTextSelector: `.${MASK_CLASS}`,
    },

    // Not a product this app uses, and it renders UI over the rider's screen.
    disable_surveys: true,

    before_send: stripIdsFromEvent,
  }
}

/**
 * Start analytics. Idempotent, silent without a key, and safe where there is no
 * browser.
 *
 * Called from an effect rather than at module scope — the opposite of
 * `initErrorReporting`, and the difference is what each one is racing. Error
 * reporting has to beat the first render, because the throw it exists to catch
 * happens there. Analytics has nothing to catch and is capture-off until a
 * round trip returns anyway, so the effect costs it nothing and keeps this out
 * of the prerender pass entirely.
 */
export function initAnalytics(): AnalyticsStatus {
  if (status !== null && status !== 'server') return 'already-initialised'

  if (typeof window === 'undefined') {
    status = 'server'
    return status
  }

  if (!KEY) {
    status = 'no-key'
    return status
  }

  posthog.init(KEY, buildPostHogOptions())
  status = 'initialised'
  if (pendingRider !== undefined) identifyAnalyticsRider(pendingRider)
  return status
}

/**
 * Apply the rider's stored preference, once it is known.
 *
 * `optedOut === false` is the only thing that turns capture on — `undefined`
 * (the read has not answered, or it failed) leaves the SDK where it started,
 * which is off. A read that fails must not be read as consent.
 */
export function applyAnalyticsPreference(optedOut: boolean | undefined): void {
  if (status !== 'initialised') return
  try {
    if (optedOut === false) {
      posthog.opt_in_capturing()
    } else if (optedOut === true) {
      posthog.opt_out_capturing()
    }
  } catch {
    // Analytics must never be able to take a screen down.
  }
}

/**
 * Attach the rider's own id.
 *
 * **`auth.uid()` and not a generated distinct id**, which is a decision rather
 * than a convenience: a rider who deletes their account leaves their events —
 * and their recordings — behind in PostHog, and `delete-account` can only ask
 * for their removal if it knows which person to name. Using the id the function
 * already holds keeps that door open at no cost. (Erasing them is not wired and
 * is an open item on PD-353; `/legal/privacy` says so plainly rather than
 * implying a deletion that does not happen.)
 *
 * `reset()` on sign-out rather than `identify(null)`: it also drops the local
 * distinct id, so the next rider on a shared device does not inherit the
 * previous one's identity or their session.
 */
export function identifyAnalyticsRider(userId: string | null): void {
  pendingRider = userId
  if (status !== 'initialised') return
  try {
    if (userId) posthog.identify(userId)
    else posthog.reset()
  } catch {
    // See `applyAnalyticsPreference`.
  }
}

/**
 * Send one of the five events.
 *
 * The union is spread rather than passed through, so PostHog receives a flat
 * property bag and the call sites keep a checked shape.
 */
export function capture(event: AnalyticsEvent): void {
  if (status !== 'initialised') return
  try {
    posthog.capture(event.name, event.properties)
  } catch {
    // See `applyAnalyticsPreference`. A failed event is never worth a failed
    // RSVP — every call site here sits after a write that already succeeded.
  }
}

/**
 * A pageview, fired by the router on every navigation.
 *
 * **Path only.** `scrubUrl` rather than a hand-rolled `split('?')` so this and
 * the two other places in the app that strip a URL cannot drift.
 */
export function capturePageview(url: string): void {
  if (status !== 'initialised') return
  try {
    posthog.capture('$pageview', { $current_url: scrubUrl(url) })
  } catch {
    // See `applyAnalyticsPreference`.
  }
}

/**
 * The current replay's id, for stamping onto a feedback row (PD-353).
 *
 * Returns `null` for a rider who opted out, for a build with no key, and for a
 * session where replay never started — all three of which are ordinary, which
 * is why `feedback.posthog_session_id` is nullable and the write is
 * best-effort. Feedback failing because analytics did not load would be a worse
 * defect than the one this fixes.
 *
 * **The id, never a replay URL.** The URL is constructible from the id and
 * changes with PostHog's routing, so a stored URL is a dead link waiting to
 * happen.
 */
export function analyticsSessionId(): string | null {
  if (status !== 'initialised') return null
  try {
    return posthog.get_session_id() || null
  } catch {
    return null
  }
}

/** For tests only — module state outlives a test file otherwise. */
export function resetAnalyticsForTests() {
  status = null
  pendingRider = undefined
}

export function analyticsStatus(): AnalyticsStatus | null {
  return status
}
