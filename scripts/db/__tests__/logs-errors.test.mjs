import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { classify, formatSummary, isAlerting, parseRows, sanitisePath } from '../logs-errors.mjs'

/**
 * The transport in `logs-errors.mjs` cannot be tested here — it needs a
 * Management API token that exists in no build container — so this pins the two
 * things that decide whether a run is trustworthy: how the envelope is read,
 * and which rows are worth waking someone for.
 *
 * Both have a lenient failure mode that looks exactly like good news, which is
 * the shape this repo keeps getting caught by. A monitor that fails open
 * reports a clean day for ever and is trusted while it does it.
 */

// The envelope as actually measured, DEV via the Supabase MCP `query_logs`
// tool on 2026-08-31. Kept verbatim so a future rename is a failing test rather
// than a silent empty page.
const MEASURED = {
  result: [{ n: 571, path: '/storage/v1/object/sign/media', status: 200 }],
  error: null,
}

describe('parseRows', () => {
  it('reads the measured envelope', () => {
    expect(parseRows(MEASURED)).toEqual(MEASURED.result)
  })

  it('treats an empty result as a real answer, not a failure', () => {
    // Both projects answered exactly this on 2026-08-31. A quiet day is the
    // common case and must stay distinguishable from a broken read.
    expect(parseRows({ result: [], error: null })).toEqual([])
  })

  it('still accepts the documented `data` fallback', () => {
    expect(parseRows({ data: [{ n: 1, path: '/rest/v1/rides', status: 500 }] })).toHaveLength(1)
  })

  // The four shapes below all used to fall through `payload.result ?? payload.data ?? []`
  // to an empty array, which this script prints as "Nothing failed". Each one
  // must now be loud. If any of these ever returns [] again, the monitor has
  // gone back to reporting a clean day whenever it cannot read the answer.
  it.each([
    ['a renamed key', { rows: [{ n: 1 }] }],
    ['an empty object', {}],
    ['an API error alongside a 200', { result: null, error: 'query timed out' }],
    ['a non-object body', 'gateway timeout'],
  ])('throws on %s rather than reporting a clean day', (_label, payload) => {
    expect(() => parseRows(payload)).toThrow()
  })

  it('names the error text when the API reports one', () => {
    expect(() => parseRows({ result: null, error: 'query timed out' })).toThrow(/query timed out/)
  })
})

describe('classify', () => {
  const rows = [
    { n: 64, path: '/rest/v1/club_discussions', status: 404 },
    { n: 3, path: '/rest/v1/rides', status: 500 },
    { n: 12, path: '/rest/v1/rpc/has_password_reset_grant', status: 401 },
    { n: 8, path: '/rest/v1/postcards', status: 403 },
    { n: 2, path: '/storage/v1/object/sign/media/missing.jpg', status: 404 },
  ]

  it('counts a 404 on a PostgREST relation as a schema mismatch', () => {
    // The PD-313 case, with its real number: 082 was ~50 minutes ahead of the
    // deploy and nothing alerted.
    expect(classify(rows).schemaMismatch).toEqual([rows[0]])
  })

  it('counts any 5xx as ours', () => {
    expect(classify(rows).serverErrors).toEqual([rows[1]])
  })

  it('leaves the guards working out of both alert buckets', () => {
    // A 401 on the reset-grant accessor is the guard refusing correctly and a
    // 403 is usually RLS doing its job. Alerting on either trains everyone to
    // ignore the alert, which costs more than the alert buys.
    const { other } = classify(rows)
    expect(other).toContain(rows[2])
    expect(other).toContain(rows[3])
  })

  it('catches a PostgREST 404 whose path arrives absolute', () => {
    // The shape of `request.path` under a 4xx is UNOBSERVED — the filtered query
    // returns no rows on either project, so the one measured row is a 200. If it
    // ever arrives absolute, an anchored prefix test would classify PD-313's 404s
    // as unremarkable and the digest would stay green through the exact outage it
    // was built for. This is the case that pins `includes` over `startsWith`.
    const absolute = [
      { n: 64, path: 'https://fpmrimzxadewsaiwpsel.supabase.co/rest/v1/club_discussions', status: 404 },
    ]
    expect(isAlerting(classify(absolute))).toBe(true)
  })

  it('does not treat a 404 outside /rest/v1/ as a schema mismatch', () => {
    // A missing Storage object is a missing file, not a relation the deployed
    // code can no longer see. Widening the prefix is the easy way to make this
    // alert fire on every deleted avatar.
    expect(classify(rows).schemaMismatch).not.toContain(rows[4])
    expect(classify(rows).other).toContain(rows[4])
  })

  it('classifies a status that arrives as a string', () => {
    // `log_attributes` values are strings upstream; the SQL casts them, but a
    // changed cast should not silently empty both alert buckets.
    const stringy = [{ n: 1, path: '/rest/v1/rides', status: '503' }]
    expect(classify(stringy).serverErrors).toHaveLength(1)
  })

  it('counts a 300 on a PostgREST relation as a schema mismatch', () => {
    // The PD-363 case, with its real number. `092` added an ordinary join
    // table, `club_members`↔`profiles` gained a second candidate relationship,
    // and PostgREST answered `PGRST201` rather than choosing — taking both club
    // lists, the club roster and the club timeline down together. 65 of these
    // landed in DEV's stream and this digest reported a clean day, because 300
    // sorts BELOW every threshold a monitor reaches for.
    const ambiguous = [{ n: 65, path: '/rest/v1/clubs', status: 300 }]
    expect(classify(ambiguous).schemaMismatch).toEqual(ambiguous)
    expect(isAlerting(classify(ambiguous))).toBe(true)
  })

  it('leaves the other 3xx alone — they are not failures', () => {
    // The reason the filter names 300 rather than widening to `>= 300`. DEV's
    // own window holds 304s on avatar fetches: a cache working. A redirect
    // behaving is the same. Sweeping the band in would put routine traffic in
    // an alert that is only credible while every row in it is a question.
    const routine = [
      { n: 7, path: '/storage/v1/object/sign/media/avatars/a.jpg', status: 304 },
      { n: 4, path: '/rest/v1/rides', status: 307 },
      { n: 2, path: '/rest/v1/clubs', status: 302 },
    ]
    expect(classify(routine).schemaMismatch).toEqual([])
    expect(classify(routine).serverErrors).toEqual([])
    expect(isAlerting(classify(routine))).toBe(false)
  })

  it('does not treat a 300 outside /rest/v1/ as a schema mismatch', () => {
    // Same boundary the 404 case pins, in the other status. Only PostgREST
    // speaks `PGRST201`; a 300 from anywhere else is not this defect.
    const elsewhere = [{ n: 1, path: '/functions/v1/search-places', status: 300 }]
    expect(classify(elsewhere).schemaMismatch).toEqual([])
    expect(classify(elsewhere).other).toEqual(elsewhere)
  })

  it('catches a 300 whose status arrives as a string', () => {
    // `AMBIGUOUS_EMBED` is compared with `Number(...)` for the same reason the
    // 5xx test above exists: the cast lives in the SQL, and a `===` against a
    // raw string would empty this bucket with nothing red.
    const stringy = [{ n: 65, path: '/rest/v1/clubs', status: '300' }]
    expect(classify(stringy).schemaMismatch).toHaveLength(1)
  })
})

describe('isAlerting', () => {
  it('is false for a page of correct refusals', () => {
    // The credibility case: a busy day of 401s and 403s must stay green.
    const rows = [
      { n: 40, path: '/rest/v1/rpc/has_password_reset_grant', status: 401 },
      { n: 9, path: '/rest/v1/postcards', status: 403 },
    ]
    expect(isAlerting(classify(rows))).toBe(false)
  })

  it('is false for no rows at all', () => {
    expect(isAlerting(classify([]))).toBe(false)
  })

  it.each([
    ['a 5xx', { n: 1, path: '/rest/v1/rides', status: 500 }],
    ['a PostgREST 404', { n: 1, path: '/rest/v1/club_discussions', status: 404 }],
  ])('is true for %s', (_label, row) => {
    expect(isAlerting(classify([row]))).toBe(true)
  })
})

describe('formatSummary', () => {
  it('says so plainly when nothing failed', () => {
    expect(formatSummary('letsride (PRODUCTION)', [], classify([]))).toContain(
      'No 300, 4xx or 5xx in the last 24 hours.',
    )
  })

  it('lists the paths when something did', () => {
    const rows = [{ n: 64, path: '/rest/v1/club_discussions', status: 404 }]
    const summary = formatSummary('letsride-dev (DEV)', rows, classify(rows))
    expect(summary).toContain('/rest/v1/club_discussions')
    expect(summary).toContain('letsride-dev (DEV)')
  })
})


describe('sanitisePath', () => {
  it('never lets a query string reach the summary', () => {
    // A job summary is readable by anyone with repo read access and is kept for
    // 90 days — far longer than the window it describes — so a token in one has
    // been published. A 4xx on either of these is exactly a row this digest
    // reports, and GitHub's secret masking cannot mask what it was never told.
    expect(sanitisePath('/auth/v1/verify?token=pkce_abc123')).toBe('/auth/v1/verify')
    expect(sanitisePath('/storage/v1/object/sign/media/a.jpg?token=eyJhbGciOi')).toBe(
      '/storage/v1/object/sign/media/a.jpg',
    )
  })

  it('leaves an ordinary path alone', () => {
    // The measured row, verbatim. Over-stripping would quietly blank the column.
    expect(sanitisePath('/storage/v1/object/sign/media')).toBe('/storage/v1/object/sign/media')
    expect(sanitisePath('/rest/v1/club_discussions')).toBe('/rest/v1/club_discussions')
  })

  it('escapes what would otherwise break the markdown table', () => {
    expect(sanitisePath('/rest/v1/a|b')).toBe('/rest/v1/a\\|b')
    expect(sanitisePath('/rest/v1/`x`')).toBe("/rest/v1/'x'")
  })

  it('survives a null path', () => {
    expect(sanitisePath(null)).toBe('')
  })
})

describe('formatSummary', () => {
  it('strips a credential-bearing query out of the published table', () => {
    const rows = [{ n: 2, path: '/auth/v1/verify?token=pkce_abc123', status: 401 }]
    const summary = formatSummary('letsride (PRODUCTION)', rows, classify(rows))
    expect(summary).not.toContain('pkce_abc123')
    expect(summary).toContain('/auth/v1/verify')
  })
})

describe('the workflow runs this without npm ci, so it must import only builtins', () => {
  it('has no non-builtin import', () => {
    // .github/workflows/log-digest.yml deliberately omits `npm ci` because this
    // script needs no node_modules. Nothing else can catch a regression: vitest
    // runs with node_modules present, so an added dependency stays green here
    // and first appears as a red digest at 06:00 UTC — which, until the exit
    // codes were split, was indistinguishable from a production 5xx.
    const source = readFileSync(new URL('../logs-errors.mjs', import.meta.url), 'utf8')
    const specifiers = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(specifiers.length).toBeGreaterThan(0)
    for (const specifier of specifiers) {
      expect(specifier.startsWith('node:')).toBe(true)
    }
  })
})
