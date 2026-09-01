import * as SentryCapacitor from '@sentry/capacitor'
import type { Breadcrumb, ErrorEvent } from '@sentry/core'
import { init as reactInit } from '@sentry/react'

import { APP_VERSION } from '@/lib/version'
import { scrubEvent, scrubValue, type JsonObject } from '@/lib/observability/scrub'

/**
 * The one doorway to error reporting — PD-315.
 *
 * Same shape as `lib/data/` and `lib/actions/`, and for the same reason: one
 * named place that talks to the outside, so the privacy posture is a property
 * of a file rather than of whoever last called `captureException`. Nothing
 * outside this directory imports `@sentry/*`, and
 * `__tests__/sentry.test.ts`'s *one doorway* case is what keeps that true.
 *
 * ## Why the Capacitor SDK alone, and not `@sentry/nextjs` beside it
 *
 * PD-142 left this repo with two build shapes and exactly one of them may
 * deploy: the Vercel web app, and `CAPACITOR_BUILD=1 next build` producing the
 * static export the shell's `webDir` copies. Sentry has a natural package for
 * each, and taking both means two `Sentry.init` paths to keep in agreement —
 * a permanent divergence between two builds that already diverge enough
 * (`next.config.ts` holds three guards about it).
 *
 * The pair here covers both, which is not obvious and is worth recording
 * because the obvious reading is that a Capacitor SDK does nothing in a
 * browser. It does: `@sentry/capacitor`'s `init` branches on
 * `NATIVE.platform === 'web'`, sets `enableNative = false`, keeps the native
 * transport out of the way, and hands the options to the sibling `init` passed
 * as its second argument — `@sentry/react`'s, here. So the web build gets the
 * browser SDK with nothing bolted on, and the bundle additionally gets iOS and
 * Android crash reporting, which is the whole reason the Notion page chose the
 * Capacitor SDK over a browser one.
 *
 * The cost, stated because `CLAUDE.md` §Technology Decisions requires a
 * dependency to be a deliberate act: **two runtime dependencies**, and
 * `@sentry/capacitor` is additionally a **native plugin** — a supply-chain
 * surface and a review question in its own right, per `.claude/agents/native.md`.
 * The two must move together and are pinned exact: `@sentry/capacitor` peers an
 * exact `@sentry/react`, so a caret on either is a resolution failure waiting
 * for whichever `npm install` runs first.
 *
 * ## The global handlers PD-315 asks for are already here
 *
 * `globalHandlersIntegration()` — `window.onerror` and `unhandledrejection` —
 * is in `@sentry/capacitor`'s default integration list, so a rejected promise
 * in an event handler, which reaches no React boundary at all, is reported
 * without a line of wiring. That is asserted rather than assumed
 * (`__tests__/sentry.test.ts`), because the assertion is what stops a future
 * `defaultIntegrations: []` from removing the one handler no boundary can
 * substitute for.
 *
 * ## No Sentry session replay, deliberately
 *
 * Replay is PostHog's job (PD-353), and it is ON and unmasked for the pilot
 * there. A second recorder would be a second copy of the same footage, a second
 * privacy disclosure, and a second store-privacy-label answer, for no question
 * the first one cannot answer. `replayIntegration` is not imported here and
 * must not be.
 *
 * ## Performance monitoring is off
 *
 * `tracesSampleRate: 0`. PD-315 ends at "a throw in a rider's browser is
 * visible to us"; traces are a different product with its own quota, and the
 * free tier's ~5k errors/month is the budget this has to live inside. Web
 * vitals are already answered — PostHog collects them (PD-353), so turning
 * traces on here would buy a second copy of that too.
 */

/**
 * Unset is the normal state on DEV, on every preview, and in local
 * development — so an unset DSN must be a clean no-op rather than a throw or a
 * console line every rider sees. It is also the state the walk runs in.
 *
 * Written out rather than read through a variable: `NEXT_PUBLIC_*` is inlined
 * by the bundler at build time, and only a literal member expression is
 * inlined. `process.env[name]` compiles to a runtime lookup against an object
 * that does not exist in the browser, which reads as "no DSN configured" on
 * every deployment — a feature that silently no-ops, which this repo has
 * shipped once already (`next.config.ts`'s CORS header).
 */
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

/**
 * One Sentry project with an `environment` tag, which is the opposite of the
 * PostHog answer on PD-353 and deliberately so: filtering an environment out of
 * an issue list is one click, where a PostHog funnel aggregates its whole
 * project by default and a DEV event corrupts it silently.
 *
 * The fallback is `'unknown'` rather than `'production'`. A build whose
 * environment variable did not arrive is a build we want to *see* mislabelled
 * in the issue list; defaulting to the real answer for the most important
 * environment is how a Preview's errors get read as riders'.
 */
const ENVIRONMENT = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'unknown'

export type ErrorReportingStatus = 'initialised' | 'no-dsn' | 'already-initialised' | 'server'

let status: ErrorReportingStatus | null = null

/**
 * The options object, separated from the call that consumes it so a test can
 * read it.
 *
 * This is the "unit-test the seam, not the transport" split PD-353 states for
 * analytics, applied here for the same reason: the network path cannot be
 * exercised anywhere this repo has a gate — there is no DSN on DEV, the walk
 * runs against DEV, and Sentry is outside this container's network policy — so
 * the assertion has to be about what we *asked* for.
 */
export function buildSentryOptions(dsn: string) {
  return {
    dsn,
    release: APP_VERSION,
    environment: ENVIRONMENT,

    // No IP address, no cookies, no request headers, and no `user` object we
    // did not set ourselves. `scrub.ts` is the second half — this flag governs
    // what the SDK collects, and that file governs what survives what we set.
    sendDefaultPii: false,

    // See the header: errors only.
    tracesSampleRate: 0,

    // A failed fetch would otherwise be captured with its request and response
    // attached, and this app's most sensitive payload — the place-search term,
    // which is frequently a home address — travels in a POST body that nothing
    // else in a report can reach. The SDK already defaults this off; it is
    // written out because the default is the only thing standing between that
    // body and a third-party dashboard, and a default is not a decision.
    enableCaptureFailedRequests: false,

    // The casts are the honest shape of this seam rather than a shortcut. The
    // SDK types an event as a union of named fields; `scrub.ts` walks it as
    // JSON precisely BECAUSE those fields are Sentry's to change — a field list
    // that type-checks today is what an SDK upgrade routes around silently, and
    // the failure mode of that is a home address in a third-party dashboard.
    // Structural typing is the whole point, so it is asserted at one line here
    // rather than weakened everywhere.
    beforeSend: (event: ErrorEvent) => scrubEvent(event as unknown as JsonObject) as unknown as ErrorEvent,

    // Breadcrumbs are where the fetch and navigation URLs live, and there are
    // dozens per event. `scrubValue` rather than `scrubEvent` because a
    // breadcrumb has no `request` or `user` of its own to strip.
    beforeBreadcrumb: (breadcrumb: Breadcrumb) =>
      scrubValue(breadcrumb as unknown as JsonObject) as unknown as Breadcrumb,
  }
}

/**
 * Start reporting. Idempotent, silent without a DSN, and safe to call in a
 * render pass that has no browser.
 *
 * Called from `Observability.tsx` at module scope rather than from an effect,
 * which is the one place in this app that is deliberately not the §Read in an
 * effect rule. That rule exists because a *Supabase read* issued during render
 * is anonymous and fails closed at RLS; this reads no data and talks to no
 * database. What it buys is the gap between the chunk evaluating and React's
 * first commit — which is precisely where a throw that takes the whole app
 * down happens, and an effect that never runs because the render before it
 * threw cannot report the throw that stopped it.
 */
export function initErrorReporting(): ErrorReportingStatus {
  if (status !== null && status !== 'server') return 'already-initialised'

  if (typeof window === 'undefined') {
    status = 'server'
    return status
  }

  if (!DSN) {
    status = 'no-dsn'
    return status
  }

  SentryCapacitor.init(buildSentryOptions(DSN), reactInit)
  status = 'initialised'
  return status
}

/** For tests only — module state outlives a test file otherwise. */
export function resetErrorReportingForTests() {
  status = null
}

export function errorReportingStatus(): ErrorReportingStatus | null {
  return status
}

/**
 * Report a caught error.
 *
 * `boundary` says which of the three React boundaries caught it, and `digest`
 * carries the reference the rider is shown on screen — which is the whole
 * point of sending it. `BoundaryError` prints `Reference: <digest>`, and until
 * now that resolved only against a server-side log, which for a client-side
 * throw does not exist. Sending it as a tag is what turns the number a rider
 * quotes in their feedback into a row we can find.
 *
 * Never throws: a failure inside error reporting must not become a second
 * error, and above all must not replace the designed fallback screen with a
 * blank one.
 */
export function reportError(
  error: unknown,
  context: { boundary: string; digest?: string }
): void {
  try {
    if (status !== 'initialised') return
    SentryCapacitor.withScope((scope) => {
      scope.setTag('boundary', context.boundary)
      if (context.digest) scope.setTag('digest', context.digest)
      SentryCapacitor.captureException(error)
    })
  } catch {
    // Deliberately silent. See above.
  }
}

/**
 * Attach the rider's own id to subsequent reports, or clear it on sign-out.
 *
 * `id` only — see `scrub.ts` for why this one identifier survives when the
 * content ids in a URL do not, and why `email` and `username` never do.
 */
export function identifyRider(userId: string | null): void {
  try {
    if (status !== 'initialised') return
    SentryCapacitor.setUser(userId ? { id: userId } : null)
  } catch {
    // Deliberately silent — see `reportError`.
  }
}
