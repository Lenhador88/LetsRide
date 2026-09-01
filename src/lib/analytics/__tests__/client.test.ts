import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MASK_CLASS,
  analyticsSessionId,
  analyticsStatus,
  buildPostHogOptions,
  capture,
  capturePageview,
  initAnalytics,
  resetAnalyticsForTests,
} from '@/lib/analytics/client'

const ROOT = path.resolve(__dirname, '../../../..')

function sourceWithoutComments(relativePath: string): string {
  // Comment-stripped, because `client.ts`'s own header names every option this
  // file searches for — `autocapture`, `enable_heatmaps`, `maskAllInputs` — in
  // prose explaining what they are set to. An un-stripped read finds the
  // explanation and passes on a file that sets the opposite. CLAUDE.md
  // §Technology Decisions calls this the comment trap; this repo has sprung it
  // four times.
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the options we hand PostHog', () => {
  const options = buildPostHogOptions()

  it('starts capture OFF', () => {
    // The boot-order rule, and the direction matters more than the value. The
    // preference lives behind a round trip, so between page load and that
    // answer the SDK either captures or does not — and fail-closed means the
    // failure is MISSING DATA rather than data from a rider who said no.
    expect(options.opt_out_capturing_by_default).toBe(true)
  })

  it('collects no autocapture and no heatmaps', () => {
    // PD-353: explicit events only. Autocapture's benefit is retroactive
    // questions, which accrue over a period with almost no riders, and it
    // collects element text from every screen.
    expect(options.autocapture).toBe(false)
    expect(options.enable_heatmaps).toBe(false)
  })

  it('fires no pageview of its own', () => {
    // Two reasons and both matter: PostHog's document-load pageview misses
    // every navigation in a client-rendered SPA, and its automatic
    // `$current_url` carries the `?id=` this app puts on every detail route.
    expect(options.capture_pageview).toBe(false)
  })

  it('takes web vitals but not network timing', () => {
    // Web vitals are four numbers with no rider content in them. Network timing
    // collects request URLs, which is the `?id=` problem by another route.
    expect(options.capture_performance).toEqual({ web_vitals: true, network_timing: false })
  })

  it('records the session, unmasked except for the place search', () => {
    expect(options.disable_session_recording).toBe(false)
    expect(options.session_recording.maskAllInputs).toBe(false)
    // The one narrowing, and the case that fails if somebody "tidies up" the
    // selector: `place_search_attempts` holds no column that could store a
    // search term because a meeting point is frequently a home address, and an
    // unmasked replay of that field reinstates exactly what the schema refuses.
    expect(options.session_recording.maskTextSelector).toBe(`.${MASK_CLASS}`)
  })

  it('runs no surveys', () => {
    expect(options.disable_surveys).toBe(true)
  })
})

describe('before_send strips the ids out of every URL PostHog sets itself', () => {
  const options = buildPostHogOptions()

  it('strips $current_url and $pathname', () => {
    const sent = options.before_send({
      event: '$pageview',
      properties: {
        $current_url: 'https://app.letsride.social/rides/detail?id=8f14e45f-ceea-467a-9d3f',
        $pathname: '/rides/detail?id=8f14e45f-ceea-467a-9d3f',
        via: 'rsvp',
      },
    })

    expect(sent?.properties?.$current_url).toBe('https://app.letsride.social/rides/detail')
    expect(sent?.properties?.$pathname).toBe('/rides/detail')
    // Everything else survives, or the strip has eaten the event.
    expect(sent?.properties?.via).toBe('rsvp')
  })

  it('does not throw on an event with no properties', () => {
    // A throw inside `before_send` drops the event, so the failure would be
    // silently missing data — the thing this whole file exists to notice.
    expect(() => options.before_send({})).not.toThrow()
    expect(() => options.before_send(null)).not.toThrow()
  })
})

describe('without a key — which is DEV, every preview, and local development', () => {
  afterEach(() => {
    resetAnalyticsForTests()
    delete (globalThis as { window?: unknown }).window
  })

  it('does nothing at all with no window', () => {
    resetAnalyticsForTests()
    expect(initAnalytics()).toBe('server')
  })

  it('is a clean no-op in a browser with no key', () => {
    resetAnalyticsForTests()
    ;(globalThis as { window?: unknown }).window = {}
    expect(initAnalytics()).toBe('no-key')
    expect(analyticsStatus()).toBe('no-key')
  })

  it('captures nothing and reports no session id', () => {
    resetAnalyticsForTests()
    ;(globalThis as { window?: unknown }).window = {}
    initAnalytics()

    expect(() => capture({ name: 'club_joined', properties: { via: 'browse' } })).not.toThrow()
    expect(() => capturePageview('/postcards')).not.toThrow()
    // The one that `sendFeedback` depends on: a build with no key must yield
    // null rather than a stale or invented id, because that value is written
    // into a database column.
    expect(analyticsSessionId()).toBeNull()
  })

  it('is idempotent', () => {
    resetAnalyticsForTests()
    ;(globalThis as { window?: unknown }).window = {}
    expect(initAnalytics()).toBe('no-key')
    expect(initAnalytics()).toBe('already-initialised')
  })
})

describe('what the source must and must not contain', () => {
  const source = sourceWithoutComments('src/lib/analytics/client.ts')

  it('never sends a replay URL, only the id', () => {
    // PD-353's rule: the URL is constructible from the id and changes with
    // PostHog's routing, so a stored URL is a dead link waiting to happen. The
    // column is `posthog_session_id` and this is what keeps it honest.
    expect(source).not.toMatch(/posthog\.com\/replay/)
    expect(source).toContain('get_session_id')
  })

  it('forces capture OFF at init rather than trusting the default', () => {
    // The hole this closes is invisible from the options object, which is why
    // it is asserted here: `opt_out_capturing_by_default` is a DEFAULT, and
    // posthog-js persists consent to localStorage, so a stored opt-IN from an
    // earlier visit wins over it. A rider who was recorded on this device and
    // later opted out on another one would come back opted in and be recorded
    // on `/auth/login` — under an unmasked pilot posture, the screen showing
    // their email being typed — because the preference cannot be read at all
    // before a session exists.
    //
    // The call must be inside `initAnalytics`, after `posthog.init`.
    const init = source.slice(source.indexOf('export function initAnalytics'))
    const initBody = init.slice(0, init.indexOf('\n}'))
    expect(initBody).toContain('posthog.init(KEY')
    expect(initBody).toContain('posthog.opt_out_capturing()')
    expect(initBody.indexOf('posthog.opt_out_capturing()')).toBeGreaterThan(
      initBody.indexOf('posthog.init(KEY')
    )
  })

  it('re-fires the pageview when it opts in, so the first screen is not lost', () => {
    // The cost of forcing capture off above: the pageview `Observability` fired
    // on mount was swallowed, and its effect will not run again until the rider
    // NAVIGATES. Without this line the first screen of every session is
    // missing, which is most of a funnel's entry point — and it fails silently,
    // exactly like the SPA pageview problem it is a second instance of.
    const apply = source.slice(source.indexOf('export function applyAnalyticsPreference'))
    const applyBody = apply.slice(0, apply.indexOf('\n}'))
    expect(applyBody).toContain('posthog.opt_in_capturing()')
    expect(applyBody).toContain('capturePageview(')
  })

  it('reads the key as a literal so the bundler inlines it', () => {
    // `process.env[name]` compiles to a runtime lookup against an object that
    // does not exist in the browser, which reads as "not configured" on every
    // deployment — a feature that silently no-ops.
    expect(source).toContain('process.env.NEXT_PUBLIC_POSTHOG_KEY')
    expect(source).not.toMatch(/process\.env\[/)
  })
})

describe('the recorder still masks passwords, whatever maskAllInputs says', () => {
  it('normalises maskAllInputs: false to { password: true }', () => {
    // A claim about a DEPENDENCY, checked against the dependency, and the most
    // important assertion in this file. The pilot posture is UNMASKED replay,
    // which is only defensible because rrweb masks `input[type=password]`
    // unconditionally — an SDK bump that changed that would put every rider's
    // password into a recording, with nothing anywhere going red.
    //
    // A moved file layout fails this too, and that is correct rather than
    // flaky: the assumption is exactly what needs re-checking on an upgrade.
    const recorder = path.join(ROOT, 'node_modules/posthog-js/dist/recorder.js')

    let contents: string
    try {
      contents = readFileSync(recorder, 'utf8')
    } catch {
      throw new Error(
        `posthog-js's replay recorder is no longer at ${recorder}. Session replay is ON ` +
          'and UNMASKED for the pilot, so re-verify BY HAND that password inputs are still ' +
          'masked unconditionally before pointing this test at the new path.'
      )
    }

    expect(contents).toContain('password:!0')
  })
})
