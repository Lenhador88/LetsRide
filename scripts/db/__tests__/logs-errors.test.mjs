import { describe, expect, it } from 'vitest'
import { classify, formatSummary, isAlerting, parseRows } from '../logs-errors.mjs'

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
      'No 4xx or 5xx in the last 24 hours.',
    )
  })

  it('lists the paths when something did', () => {
    const rows = [{ n: 64, path: '/rest/v1/club_discussions', status: 404 }]
    const summary = formatSummary('letsride-dev (DEV)', rows, classify(rows))
    expect(summary).toContain('/rest/v1/club_discussions')
    expect(summary).toContain('letsride-dev (DEV)')
  })
})
