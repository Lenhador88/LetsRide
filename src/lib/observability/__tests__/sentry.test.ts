import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildSentryOptions,
  errorReportingStatus,
  initErrorReporting,
  reportError,
  resetErrorReportingForTests,
} from '@/lib/observability/sentry'

const ROOT = path.resolve(__dirname, '../../../..')

/**
 * Strip comments before asserting on source — the trap `RideInviteJoin`'s own
 * docstring set for its first test, one directory over.
 *
 * `sentry.ts`'s header says in prose that `replayIntegration` is not imported
 * and that `defaultIntegrations: []` would be a regression. Both are the exact
 * strings the cases below search for, so an un-stripped read finds them in the
 * file that is *correct* and fails. That is CLAUDE.md §Technology Decisions'
 * comment trap: a file's description of what it does not do looks exactly like
 * doing it.
 */
function sourceWithoutComments(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the options we hand Sentry', () => {
  const options = buildSentryOptions('https://key@o0.ingest.sentry.io/1')

  it('turns default PII collection off', () => {
    expect(options.sendDefaultPii).toBe(false)
  })

  it('sends no performance traces', () => {
    // PD-315 ends at "a throw in a rider's browser is visible to us". Traces are
    // a different product with their own quota, and the free tier's ~5k
    // errors/month is the budget this has to live inside.
    expect(options.tracesSampleRate).toBe(0)
  })

  it('never captures a failed request', () => {
    // The one that matters most and reads as redundant: the SDK already
    // defaults this off, and this app's most sensitive payload — a
    // place-search term, which is frequently a home address — travels in a
    // POST body that no other part of a report can reach. A default is not a
    // decision, and this is what makes flipping it a red test rather than a
    // quiet change.
    expect(options.enableCaptureFailedRequests).toBe(false)
  })

  it('tags the build so a crash can be placed against a release', () => {
    expect(options.release).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('labels an unconfigured environment "unknown" rather than guessing production', () => {
    // Fails loudly in the issue list instead of quietly filing a Preview's
    // errors as riders'. The variable is unset in this suite, which is exactly
    // the case being asserted.
    expect(options.environment).toBe('unknown')
  })
})

describe('the scrub is actually wired in', () => {
  // Two separate claims: `scrub.test.ts` proves the functions are right, and
  // this proves they are CONNECTED. A `beforeSend` accidentally dropped from
  // the options object leaves every one of those tests green while the app
  // ships unscrubbed payloads.
  const options = buildSentryOptions('https://key@o0.ingest.sentry.io/1')

  it('beforeSend strips a query string and drops cookies', () => {
    const out = options.beforeSend({
      request: { url: 'https://app.letsride.social/rides/detail?id=abc', cookies: { a: 'b' } },
    } as never) as unknown as { request: Record<string, unknown> }

    expect(out.request.url).toBe('https://app.letsride.social/rides/detail')
    expect(out.request.cookies).toBeUndefined()
  })

  it('beforeBreadcrumb strips a fetch URL', () => {
    const out = options.beforeBreadcrumb({
      category: 'fetch',
      data: { url: 'https://ref.supabase.co/rest/v1/rides?id=eq.abc' },
    } as never) as unknown as { data: { url: string } }

    expect(out.data.url).toBe('https://ref.supabase.co/rest/v1/rides')
  })
})

describe('the two states in which nothing may happen', () => {
  afterEach(() => {
    resetErrorReportingForTests()
    delete (globalThis as { window?: unknown }).window
  })

  it('does nothing at all with no window', () => {
    // The prerender pass. `Observability.tsx` calls this at MODULE scope, so it
    // runs during `next build` on every static route — a throw here would fail
    // the build, and an SDK init there would be a browser SDK with no browser.
    resetErrorReportingForTests()
    expect(initErrorReporting()).toBe('server')
    expect(() => reportError(new Error('boom'), { boundary: 'app' })).not.toThrow()
  })

  it('is a clean no-op in a browser with no DSN', () => {
    // The normal state on DEV, on every preview and in local development — and
    // the state `npm run walk` runs in. It must not throw and must not print.
    //
    // The window is stubbed because this suite's environment is `node`
    // (`vitest.config.ts`), which is why the case above and this one are two
    // tests rather than one: without the stub, a broken DSN check would still
    // read `server` and pass.
    resetErrorReportingForTests()
    ;(globalThis as { window?: unknown }).window = {}
    expect(initErrorReporting()).toBe('no-dsn')
    expect(errorReportingStatus()).toBe('no-dsn')
    expect(() => reportError(new Error('boom'), { boundary: 'app' })).not.toThrow()
  })

  it('is idempotent, because the module is evaluated once but React is not', () => {
    resetErrorReportingForTests()
    ;(globalThis as { window?: unknown }).window = {}
    expect(initErrorReporting()).toBe('no-dsn')
    expect(initErrorReporting()).toBe('already-initialised')
  })
})

describe('what the source must and must not contain', () => {
  const source = sourceWithoutComments('src/lib/observability/sentry.ts')

  it('does not override defaultIntegrations', () => {
    // `globalHandlersIntegration()` — `window.onerror` and `unhandledrejection`
    // — is a default. It is the only path by which a rejected promise in an
    // event handler is reported at all: no React boundary can see one. Setting
    // `defaultIntegrations` at all is how it goes away silently, so the
    // assertion is on the absence of the key rather than on the presence of the
    // integration.
    expect(source).not.toContain('defaultIntegrations')
  })

  it('imports no replay integration', () => {
    // Replay is PostHog's (PD-353) and is ON and unmasked for the pilot there.
    // A second recorder is a second copy of the same footage, a second privacy
    // disclosure and a second store-privacy-label answer.
    expect(source.toLowerCase()).not.toContain('replay')
  })
})

describe('the SDK still installs the global handlers we are relying on', () => {
  it('lists globalHandlersIntegration among its defaults', () => {
    // A claim about a DEPENDENCY, checked against the dependency, because
    // nothing else can see it: PD-315 asks for `onerror` and
    // `unhandledrejection`, this repo wires neither by hand, and an SDK upgrade
    // that stopped defaulting them would leave the story looking complete and
    // silently uncovered.
    //
    // A moved file layout fails this too, and that is correct rather than
    // flaky: the assumption is exactly what needs re-checking on an upgrade.
    const defaults = path.join(
      ROOT,
      'node_modules/@sentry/capacitor/dist/esm/integrations/default.js'
    )

    let contents: string
    try {
      contents = readFileSync(defaults, 'utf8')
    } catch {
      throw new Error(
        `@sentry/capacitor's default-integration module is no longer at ${defaults}. ` +
          'Re-verify by hand that window.onerror and unhandledrejection are still ' +
          'default integrations, then point this test at the new path.'
      )
    }

    expect(contents).toContain('globalHandlersIntegration')
  })
})

describe('one doorway', () => {
  it('nothing outside src/lib/observability imports @sentry/*', () => {
    // Same rule as `lib/data/` and `lib/actions/`, and for the same reason: the
    // privacy posture in `scrub.ts` is only a property of the app while every
    // event goes through `sentry.ts`. A `captureException` called directly from
    // a component would bypass `beforeSend` entirely — it would not, in fact,
    // since `beforeSend` is a client option, but it would bypass the *review*
    // that keeps this file honest, and it is the second copy of an init that
    // actually diverges.
    const hits = execGrep()
    expect(hits).toEqual([])
  })
})

function execGrep(): string[] {
  // A filesystem walk rather than a shell out: `docs:check`'s cheap set
  // excludes claims whose ground truth is another tool's human-readable
  // output, having failed twice on the CI runner while passing locally. The
  // same reasoning applies to spawning `grep` from a test.
  const results: string[] = []
  const observability = path.join('src', 'lib', 'observability')

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const rel = path.relative(ROOT, full)
      if (rel.startsWith(observability)) continue
      // Comment-stripped, for the same reason every source assertion here is:
      // a file explaining why it does NOT import Sentry reads as one that does.
      if (/from '@sentry\//.test(sourceWithoutComments(rel))) results.push(rel)
    }
  }

  walk(path.join(ROOT, 'src'))
  return results
}
