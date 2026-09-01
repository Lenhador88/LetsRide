import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  NO_CAPTURE_CLASS,
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
    // The one narrowing. **`blockClass` and not `maskTextClass`**, and the
    // distinction is the whole mechanism rather than a naming preference:
    // rrweb takes an input's value from `maskInputOptions` alone and never
    // consults a text-mask class, so the first version of this asserted a
    // setting that recorded the meeting point verbatim. This case is worth
    // nothing on its own — see the pair of cases below, which assert the two
    // halves that actually make the block work.
    expect(options.session_recording.blockClass).toBe(NO_CAPTURE_CLASS)
    expect(NO_CAPTURE_CLASS).toBe('ph-no-capture')
  })

  it('asks PostHog to mask personal data properties as well', () => {
    // Belt and braces with `before_send` rather than instead of it: this covers
    // properties the app never names, `before_send` covers the ones a future
    // SDK adds. Neither is a superset.
    expect(options.mask_personal_data_properties).toBe(true)
  })

  it('runs no surveys', () => {
    expect(options.disable_surveys).toBe(true)
  })
})

describe('the place-search block, which was a no-op in its first form', () => {
  const field = sourceWithoutComments('src/components/ui/PlaceSearchField.tsx')

  it('puts the block class on the wrapper, not on the input', () => {
    // Two independent reasons the obvious placement fails, both measured
    // against the installed recorder: rrweb reads an input's value from
    // `maskInputOptions` alone and never consults a class, and an `<input>` has
    // no descendant text nodes for a text-mask to reach. The class has to sit
    // on an ELEMENT WHOSE SUBTREE is blocked.
    const input = field.slice(field.indexOf('<input\n            ref={inputRef}'))
    const inputTag = input.slice(0, input.indexOf('/>'))
    expect(inputTag).not.toContain('NO_CAPTURE_CLASS')

    // On the outermost wrapper, which is the nearest common ancestor of the
    // input and the suggestion panel.
    expect(field).toContain("cn(NO_CAPTURE_CLASS, 'flex w-full flex-col gap-1.5')")
  })

  it('covers the suggestion panel, which is a SIBLING of the input', () => {
    // The half that survives even a working input mask: the geocoder returns
    // full addresses, so blocking the field alone still puts one on screen.
    // Asserted structurally — the panel must render INSIDE the classed
    // wrapper, so the wrapper must open before it and close after.
    const wrapperAt = field.indexOf('cn(NO_CAPTURE_CLASS')
    const panelAt = field.indexOf('overflow-y-auto rounded-lg border-2 border-border bg-surface')
    expect(wrapperAt).toBeGreaterThan(-1)
    expect(panelAt).toBeGreaterThan(wrapperAt)
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
    }) as { properties: Record<string, string> }

    expect(sent.properties.$current_url).toBe('https://app.letsride.social/rides/detail')
    expect(sent.properties.$pathname).toBe('/rides/detail')
    // Everything else survives, or the strip has eaten the event.
    expect(sent.properties.via).toBe('rsvp')
  })

  it('strips the session-entry URL, which rides on EVERY event', () => {
    // Missed by the first version's four-key list. The session-props manager
    // attaches the full href of whatever screen started the session, so one
    // deep link stamps a content id onto every event for that whole session.
    const sent = options.before_send({
      event: 'ride_joined',
      properties: {
        $session_entry_url: 'https://app.letsride.social/postcards/detail?id=abc-123',
        $session_entry_pathname: '/postcards/detail?id=abc-123',
      },
    }) as { properties: Record<string, string> }

    expect(sent.properties.$session_entry_url).toBe('https://app.letsride.social/postcards/detail')
    expect(sent.properties.$session_entry_pathname).toBe('/postcards/detail')
  })

  it('strips $set_once, which is a SIBLING of properties and outlives the event', () => {
    // The worst of the three, because these land as PERSON properties: durable
    // on the profile rather than on one event. A rider opening one deep link
    // stamped a content id onto their profile for good.
    const sent = options.before_send({
      event: '$pageview',
      properties: {},
      $set_once: {
        $initial_current_url: 'https://app.letsride.social/clubs/detail?id=def-456',
        $initial_pathname: '/clubs/detail?id=def-456',
      },
    }) as { $set_once: Record<string, string> }

    expect(sent.$set_once.$initial_current_url).toBe('https://app.letsride.social/clubs/detail')
    expect(sent.$set_once.$initial_pathname).toBe('/clubs/detail')
  })

  it('matches by key SHAPE, so a key nobody enumerated is still stripped', () => {
    // The doctrine `scrub.ts` already holds: the keys are PostHog's to add, and
    // a list that type-checks today is what the next SDK version routes around
    // silently.
    const sent = options.before_send({
      event: 'x',
      properties: { $some_future_url: 'https://app.letsride.social/rides?id=z', n: 1 },
    }) as { properties: Record<string, unknown> }

    expect(sent.properties.$some_future_url).toBe('https://app.letsride.social/rides')
    expect(sent.properties.n).toBe(1)
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

    // **Asserted on the FALSE BRANCH, not on the substring.** `password:!0`
    // also terminates the `maskAllInputs: true` map, so the naive assertion
    // stays green with the guarantee removed — which is what a reviewer proved
    // by deleting the branch from a copy of the recorder and watching this
    // file pass. The branch is what the unmasked posture actually rests on:
    // `!1 === k` is `maskAllInputs: false`, and `{password:!0}` is what it
    // normalises to.
    expect(contents).toContain('!1===k?{password:!0}')
  })
})
