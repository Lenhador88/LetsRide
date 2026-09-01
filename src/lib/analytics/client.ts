import posthog from 'posthog-js'

import type { AnalyticsEvent } from '@/lib/analytics/events'
import { scrubUrl } from '@/lib/observability/scrub'

/**
 * The one doorway to PostHog — PD-353.
 *
 * Same shape as `lib/data/`, `lib/actions/` and `lib/observability/`, and PD-353
 * asks for it by name: *"Every event goes through one thin module that owns
 * `capture`."* Nothing outside this directory imports `posthog-js`, and
 * `__tests__/events-at-the-call-sites.test.ts` is what keeps that true.
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
 * `__tests__/client.test.ts` so an SDK bump that changed it is red.
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
 * The class that keeps a meeting-point search out of the recording.
 *
 * **This is the one narrowing of "unmasked", and it is deliberate rather than
 * an oversight.** `place_search_attempts` (`069`) holds **no column that could
 * store the term**, on the stated ground that a meeting-point search is
 * frequently a home address. Recording the same keystrokes as video in a
 * third-party store reinstates exactly what the schema was written to refuse,
 * at higher fidelity and with a different retention — and silently, because
 * nothing anywhere compares a replay setting against a schema decision.
 *
 * **It is a BLOCK class, not a mask class, and the difference is the whole
 * mechanism.** The first version of this used `ph-mask` and did nothing at
 * all, in two independent ways:
 *
 * 1. **rrweb masks input VALUES from `maskInputOptions` alone**, keyed on tag
 *    name and input type. It never consults `maskTextClass` or
 *    `maskTextSelector` for them. The place search is `type="text"`, and
 *    `maskAllInputs: false` normalises to `{password: true}` — so the field
 *    was recorded verbatim.
 * 2. **An `<input>` has no descendant text nodes**, so a text-mask class on it
 *    has nothing to mask even where text masking does apply.
 *
 * It also has to cover the **suggestion panel**, which is a SIBLING of the
 * input rather than a descendant: the geocoder returns full addresses, so
 * masking the field alone would still put "Hoofdstraat 12, 1234 AB" on screen
 * and in the recording. Hence the class goes on the wrapper that contains
 * both, and hence a block rather than a mask — blocking replaces the subtree
 * with a placeholder of the same size, so the replay still shows a rider
 * reaching the field, tapping it and moving on, which is what the composer
 * funnel needs.
 *
 * `ph-no-capture` is rrweb's default `blockClass` and posthog-js's default for
 * it; it is passed explicitly below so the wiring is assertable rather than
 * inherited.
 *
 * Everything else stays unmasked as asked. Undoing this is deleting one class
 * from one component.
 */
export const NO_CAPTURE_CLASS = 'ph-no-capture'

/**
 * Strip the ids out of every URL-shaped property PostHog attaches by itself.
 *
 * That matters here more than it would in most apps: **every detail route in
 * this app carries its subject's id in `?id=`** — a postcard, a club, a ride,
 * i.e. other riders' content on a screen this rider merely had open. It is the
 * same rule `feedback.route` (`084`) and `lib/observability/scrub.ts` already
 * hold, and `scrubUrl` is imported rather than re-spelled so the three cannot
 * disagree about what a stripped URL is.
 *
 * ## Two things a fixed key list gets wrong, both measured
 *
 * The first version named four keys under `event.properties`, and leaked on
 * both counts:
 *
 * 1. **`$set_once` is a SIBLING of `properties`, not a member of it.** PostHog
 *    assembles `{properties, $set_once}` and hands the whole object to
 *    `before_send`. So `$set_once.$initial_current_url`, `$current_url` and
 *    `$pathname` were untouched — and those become **person** properties,
 *    durable on the profile rather than on one event. A rider opening one deep
 *    link stamped a content id onto their profile for good.
 * 2. **`$session_entry_url` and `$session_entry_pathname` are on every
 *    event**, attached by the session-props manager, carrying the full href of
 *    whatever screen started the session.
 *
 * So this matches **by key shape** rather than by a list, which is
 * `scrub.ts`'s doctrine for exactly this reason: the keys are PostHog's to
 * add, and a list that type-checks today is what the next SDK version routes
 * around silently. Anything whose key mentions a url, a pathname or a referrer
 * gets `scrubUrl`, wherever it sits in the event.
 */
const URL_KEY_PATTERN = /url|pathname|referrer/i

function stripUrlIds(node: unknown, depth = 0): void {
  if (depth > 6 || node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      if (URL_KEY_PATTERN.test(key)) record[key] = scrubUrl(value)
    } else if (value !== null && typeof value === 'object') {
      stripUrlIds(value, depth + 1)
    }
  }
}

function stripIdsFromEvent<T>(event: T): T {
  // Mutates in place and returns the same object: `before_send` may return a
  // new object or null (which DROPS the event), and rebuilding one risks
  // losing a field PostHog set that this function does not know about.
  stripUrlIds(event)
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
      // Explicit even though it is rrweb's default, so the one narrowing above
      // is a line a test can read rather than an inherited default that a
      // future config edit could silently drop.
      blockClass: NO_CAPTURE_CLASS,
    },

    // Not a product this app uses, and it renders UI over the rider's screen.
    disable_surveys: true,

    // PostHog's own lever for the same hazard, and set as well as rather than
    // instead of `before_send`: it covers properties this app never names, and
    // `before_send` covers the ones a future SDK adds after this line was
    // written. Neither is a superset of the other.
    mask_personal_data_properties: true,

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

  // **Forced off, on every load, even though `opt_out_capturing_by_default` is
  // already true — and this line is the one that actually closes the hole.**
  //
  // That option is a DEFAULT: posthog-js persists consent to `localStorage`, and
  // a stored opt-IN from an earlier visit wins over it. So a rider who was
  // recorded on this device and later opted out on ANOTHER one comes back
  // opted in, and is recorded until the round trip below answers — on
  // `/auth/login`, which under this app's unmasked pilot posture is the screen
  // showing their email being typed. The preference cannot be read there at
  // all: `my_analytics_opt_out()` is `security definer` on the caller's own row
  // and there is no caller until a session exists (decision #1).
  //
  // The cost is one round trip of un-recorded session per load, and
  // `applyAnalyticsPreference` fires the pageview it swallowed. That is the
  // right way round: the failure is missing data rather than data from a rider
  // who said no.
  posthog.opt_out_capturing()

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
    if (optedOut === true) {
      posthog.opt_out_capturing()
      return
    }
    if (optedOut !== false) return

    posthog.opt_in_capturing()

    // The pageview `Observability` fired on mount was swallowed by the forced
    // opt-out in `initAnalytics`, and its effect will not run again until the
    // rider NAVIGATES — so without this the first screen of every session is
    // missing, which is most of a funnel's entry point. Fired here rather than
    // left to PostHog's own opt-in event, whose `$current_url` would carry the
    // `?id=` this app puts on every detail route.
    capturePageview(window.location.pathname)
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
 *
 * **`reset()` also clears the stored consent**, which with
 * `opt_out_capturing_by_default` means the instance is opted out afterwards —
 * so it must run BEFORE `opt_in_capturing()`, never after, or capturing stops
 * silently. That ordering holds here by construction rather than by care:
 * `writeSession` calls this, and `applyAnalyticsPreference` runs only once the
 * stamp read that follows a sign-in has returned. Do not move either.
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
    // **`get_session_id()` does NOT consult consent** — it reads the session
    // manager and answers a real id for an opted-out rider. `096`'s trigger
    // nulls the column server-side either way, so nothing lands, but a
    // docstring promising a client-side guarantee that a second caller could
    // inherit is worse than no guarantee. Asked explicitly.
    if (posthog.has_opted_out_capturing()) return null
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
