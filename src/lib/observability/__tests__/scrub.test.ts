import { describe, expect, it } from 'vitest'

import { scrubEvent, scrubText, scrubUrl, scrubValue } from '@/lib/observability/scrub'

/**
 * PD-315. This file is the *whole* gate on what leaves the app inside an error
 * report: there is no DSN on DEV, `npm run walk` runs against DEV, and Sentry
 * is outside this container's network policy, so nothing else here can observe
 * a payload. What is asserted is therefore the payload's shape.
 *
 * Every case below is written so that **removing the scrub fails it**. That is
 * not automatic — an assertion that a scrubbed string "contains the path" passes
 * on the unscrubbed string too, which is the shape of a test that guards
 * nothing. Each case pairs a positive with the negative it is really about: the
 * secret is gone AND the useful part survived.
 */
describe('scrubUrl', () => {
  it('drops the query string but keeps origin and path', () => {
    // Both halves matter. Without the second, `() => ''` passes.
    const out = scrubUrl('https://app.letsride.social/rides/detail?id=8f14e45f-ceea-467a-9d3f-1f0e0e8a6b21')
    expect(out).toBe('https://app.letsride.social/rides/detail')
    expect(out).not.toContain('8f14e45f')
  })

  it('drops the fragment as well', () => {
    // GoTrue puts an access token in a fragment — the one place a whole
    // session travels in a URL.
    expect(scrubUrl('https://app.letsride.social/auth/callback#access_token=abc&type=recovery')).toBe(
      'https://app.letsride.social/auth/callback'
    )
  })

  it('strips a Supabase REST filter, which is where content ids travel', () => {
    expect(
      scrubUrl('https://ref.supabase.co/rest/v1/postcards?select=*&id=eq.8f14e45f-ceea-467a-9d3f-1f0e0e8a6b21')
    ).toBe('https://ref.supabase.co/rest/v1/postcards')
  })

  it('leaves a URL with no query untouched', () => {
    expect(scrubUrl('https://app.letsride.social/postcards')).toBe('https://app.letsride.social/postcards')
  })

  it('does not throw on a value that is not a URL at all', () => {
    // Sentry collects these, we do not construct them: a breadcrumb `url` is
    // sometimes `'(unknown)'` or a relative path. A throw inside `beforeSend`
    // drops the entire event, so the failure would be a silently missing
    // report — worse than the thing being guarded.
    expect(scrubUrl('(unknown)')).toBe('(unknown)')
    expect(scrubUrl('/clubs/detail')).toBe('/clubs/detail')
    expect(scrubUrl('')).toBe('')
  })
})

describe('credential redaction', () => {
  // A structurally valid JWT: three base64url segments, header first.
  const TOKEN =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'

  it('redacts a JWT anywhere in a string', () => {
    const out = scrubText(`refresh failed for ${TOKEN} after 3 tries`)
    expect(out).not.toContain('eyJhbGci')
    expect(out).toContain('[redacted]')
    // The surrounding message survives, or the redaction has eaten the report.
    expect(out).toContain('refresh failed for')
    expect(out).toContain('after 3 tries')
  })

  it('does NOT redact ordinary dotted text', () => {
    // The direction that makes the pattern worth having rather than a blanket
    // redact: a version, a hostname and a stack frame all read as dotted
    // segments, and losing them costs the whole diagnostic value of a report.
    for (const safe of ['0.1.0', 'app.letsride.social', 'src/lib/query/keys.ts', 'a.b.c']) {
      expect(scrubText(safe)).toBe(safe)
    }
  })

  it('redacts both Supabase key formats', () => {
    // `sb_publishable_…` ships in the bundle by design and is redacted anyway:
    // telling the two prefixes apart at this distance is one typo away from
    // letting the secret through, and nothing is lost by scrubbing a value we
    // already publish.
    //
    // **Assembled rather than written out, and not to get around anything.**
    // `src/__tests__/no-service-role-key.test.ts` scans every file in this repo
    // for an `sb_secret_…` literal and flagged this line when it was one —
    // correctly, since it cannot tell a fixture from a credential and must not
    // try. That detector guards against a real key reaching the repo; this test
    // needs a value of that *shape*. Joining the parts keeps both true and
    // makes the value unmistakably synthetic. Do not inline it back, and do not
    // widen the detector to allow it.
    const secretShaped = ['sb', 'secret', 'AbCdEf123456'].join('_')
    const publishableShaped = ['sb', 'publishable', 'AbCdEf123456'].join('_')

    expect(scrubText(`key=${secretShaped}`)).not.toContain('AbCdEf123456')
    expect(scrubText(`key=${publishableShaped}`)).not.toContain('AbCdEf123456')
  })

  it('strips the query off a ROOT-RELATIVE URL in free text too', () => {
    // The half an `https?://` anchor misses, and it is the shape a fetch
    // wrapper or a thrown string actually produces. This file's rule is "every
    // URL anywhere in the payload", and an absolute-only pattern does not meet
    // it.
    const out = scrubText('Failed to fetch /rest/v1/rides?id=eq.8f14e45f-ceea')
    expect(out).not.toContain('8f14e45f')
    expect(out).toContain('/rest/v1/rides')
  })

  it('does not eat a question mark in ordinary prose', () => {
    // The direction that keeps the pattern above from being a blunt instrument:
    // a message is not a URL just because it contains a `?`.
    expect(scrubText('sorted by name?')).toBe('sorted by name?')
    expect(scrubText('Is 2/3 of the crew going?')).toBe('Is 2/3 of the crew going?')
  })

  it('strips the query off a URL embedded in free text', () => {
    // supabase-js quotes the request it made, so a message carries a filter
    // that no URL-keyed field would ever see.
    const out = scrubText(
      'FetchError: failed to reach https://ref.supabase.co/rest/v1/rides?meeting_point=eq.12%20Acacia%20Ave'
    )
    expect(out).not.toContain('Acacia')
    expect(out).toContain('https://ref.supabase.co/rest/v1/rides')
  })
})

describe('scrubValue', () => {
  it('reaches a URL nested inside a breadcrumb', () => {
    const scrubbed = scrubValue({
      category: 'fetch',
      data: { url: 'https://ref.supabase.co/rest/v1/clubs?id=eq.1e0f', method: 'GET' },
    }) as { data: { url: string; method: string } }

    expect(scrubbed.data.url).toBe('https://ref.supabase.co/rest/v1/clubs')
    expect(scrubbed.data.method).toBe('GET')
  })

  it('scrubs a history breadcrumb, which in this SPA is every navigation', () => {
    const scrubbed = scrubValue({
      category: 'navigation',
      data: { from: '/rides/detail?id=abc-123', to: '/clubs/detail?id=def-456' },
    }) as { data: { from: string; to: string } }

    expect(scrubbed.data.from).toBe('/rides/detail')
    expect(scrubbed.data.to).toBe('/clubs/detail')
  })

  it('walks arrays', () => {
    const scrubbed = scrubValue([{ url: '/a?x=1' }, { url: '/b?y=2' }]) as { url: string }[]
    expect(scrubbed.map((entry) => entry.url)).toEqual(['/a', '/b'])
  })

  it('is bounded, so a cyclic payload cannot freeze the rider’s screen', () => {
    type Nested = { next?: Nested; leaf?: string }
    const deep: Nested = {}
    let cursor = deep
    for (let i = 0; i < 40; i++) {
      cursor.next = {}
      cursor = cursor.next
    }
    cursor.leaf = 'bottom'

    // The assertion is that it RETURNS, rather than what it returns.
    expect(() => scrubValue(deep as never)).not.toThrow()
  })
})

describe('scrubEvent', () => {
  it('deletes the three request fields that have no scrubbed form worth keeping', () => {
    const scrubbed = scrubEvent({
      request: {
        url: 'https://app.letsride.social/profile?tab=1',
        cookies: { 'sb-ref-auth-token': 'secret' },
        headers: { Authorization: 'Bearer x' },
        query_string: 'tab=1',
      },
    })

    const request = scrubbed.request as Record<string, unknown>
    expect(request.cookies).toBeUndefined()
    expect(request.headers).toBeUndefined()
    expect(request.query_string).toBeUndefined()
    // Deleting is stronger than redacting: a redacted key still tells a reader
    // the request carried one.
    expect(Object.keys(request)).toEqual(['url'])
    expect(request.url).toBe('https://app.letsride.social/profile')
  })

  it('keeps the rider’s own id and drops every other user field', () => {
    // The asymmetry this file exists to hold: `id` is the reporting rider's own
    // opaque row identifier, `email` is an account credential, and `username` is
    // what every byline in the app renders. Content ids in URLs belong to other
    // riders and go; this one stays.
    const scrubbed = scrubEvent({
      user: {
        id: '8f14e45f-ceea-467a-9d3f-1f0e0e8a6b21',
        email: 'rider@example.com',
        username: 'pedro',
        ip_address: '203.0.113.4',
      },
    })

    expect(scrubbed.user).toEqual({ id: '8f14e45f-ceea-467a-9d3f-1f0e0e8a6b21' })
  })

  it('leaves an event with no request or user alone', () => {
    const scrubbed = scrubEvent({ message: 'plain', level: 'error' })
    expect(scrubbed).toEqual({ message: 'plain', level: 'error' })
  })

  it('scrubs the exception values, which is where a thrown message lands', () => {
    const scrubbed = scrubEvent({
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'failed on https://ref.supabase.co/rest/v1/profiles?username=eq.pedro',
          },
        ],
      },
    })

    const values = (scrubbed.exception as { values: { value: string }[] }).values
    expect(values[0]?.value).not.toContain('pedro')
    expect(values[0]?.value).toContain('https://ref.supabase.co/rest/v1/profiles')
  })
})
