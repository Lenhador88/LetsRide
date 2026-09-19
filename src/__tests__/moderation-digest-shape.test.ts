import { describe, expect, it } from 'vitest'

import {
  BATCH_SIZE,
  SWEPT_SOURCES,
  classifyMailStatus,
  countsBySource,
  formatDigestTime,
  renderDigest,
  renderEntry,
  subjectFor,
  type DigestEntry,
  type DigestSource,
} from '../../supabase/functions/send-moderation-digest/shape'

/**
 * `send-moderation-digest/shape.ts` — every decision the digest makes.
 *
 * This file is the only reason `tsc` and Vitest see that module at all:
 * `tsconfig.json` excludes `supabase/functions`, so the sibling `index.ts` and
 * `mail.ts` are unchecked by every gate in the repo except `deno check` and
 * ESLint. The split, and this test holding the other end of it, is copied from
 * `search-places/shape.ts` + `place-search-shape.test.ts` and
 * `push-notify/shape.ts` + `push-notify-shape.test.ts`.
 *
 * **Two groups here are load-bearing rather than coverage.**
 *
 * §The projection is a whitelist is the security property the whole change
 * rests on. A privileged role assembles this mail, so RLS is not in the path;
 * `design.md` D5 states the containment as a list of columns, and the enforcement
 * is the claim RPC's `returns table (...)` *plus* a renderer that reads named
 * fields and never iterates the row. The second is not redundant — it is what
 * stops a later `select *` convenience in the RPC from becoming a data leak in
 * the same commit. So the test hands the renderer a row **carrying every column
 * the design refuses** and asserts none of them come out. Verified both ways:
 * the last case in that group proves the detector still catches a real leak, or
 * a renderer that emitted nothing at all would satisfy every assertion above it.
 *
 * §The status classifier, because its failure is silent. A transient provider
 * blip misread as permanent burns the attempt cap on real reports and leaves
 * them unsent until somebody re-arms them by hand.
 */

const REPORT_SOURCES: DigestSource[] = [
  'postcard_report',
  'club_thread_report',
  'ride_thread_report',
  'postcard_comment_report',
]

const report = (over: Partial<DigestEntry> = {}): DigestEntry => ({
  entry_id: 'e1',
  source: 'postcard_report',
  source_id: 'p1',
  created_at: '2026-09-19T06:12:00.000Z',
  reason: 'nudity',
  note: null,
  reports_on_subject: 2,
  reports_on_author: 5,
  body: null,
  app_version: null,
  route: null,
  has_session_replay: null,
  ...over,
})

const feedback = (over: Partial<DigestEntry> = {}): DigestEntry => ({
  entry_id: 'e2',
  source: 'feedback',
  source_id: 'f1',
  created_at: '2026-09-19T07:30:00.000Z',
  reason: null,
  note: null,
  reports_on_subject: null,
  reports_on_author: null,
  body: 'The map tile never loads on my ride',
  app_version: '1.4.0',
  route: '/rides/abc',
  has_session_replay: true,
  ...over,
})

describe('the source list', () => {
  it('sweeps every kind the type declares, so a new kind cannot be silently unswept', () => {
    // `DigestSource` is a union and `SWEPT_SOURCES` is a value, so nothing in
    // the type system relates them. This is that relation. A kind added to the
    // union and not to the constant is a source the claim RPC does not read,
    // which would be a report surface the digest quietly omits.
    expect([...SWEPT_SOURCES].sort()).toEqual(
      [...REPORT_SOURCES, 'feedback' as DigestSource].sort(),
    )
  })

  it('claims a bounded batch', () => {
    expect(BATCH_SIZE).toBeGreaterThan(0)
    expect(BATCH_SIZE).toBeLessThanOrEqual(200)
  })
})

describe('the subject line carries counts and nothing a rider typed', () => {
  it('names each source with its own count', () => {
    const subject = subjectFor([report(), report({ entry_id: 'e1b' }), feedback()])
    expect(subject).toBe('LetsRide moderation: 2 postcard reports, 1 feedback note')
  })

  it('is singular for one', () => {
    expect(subjectFor([report()])).toBe('LetsRide moderation: 1 postcard report')
  })

  it('omits a source with nothing in the batch', () => {
    expect(subjectFor([feedback()])).not.toContain('report')
  })

  /**
   * N49. A header is the one field every mail client, notification preview and
   * log line displays, and the one place a newline is a protocol boundary rather
   * than a character. So no rider-authored value may reach it — not a report's
   * note, not a feedback body, and not a reason string a rider could influence.
   */
  it('contains no rider-authored text, even when every field is loaded with it', () => {
    const subject = subjectFor([
      report({ reason: 'REASON-LEAK', note: 'NOTE-LEAK' }),
      feedback({ body: 'BODY-LEAK\nSubject: forged' }),
    ])
    expect(subject).not.toContain('LEAK')
    expect(subject).not.toContain('forged')
    expect(subject).not.toContain('\n')
  })
})

describe('the blocks', () => {
  it('renders a report with its reason and both counts', () => {
    const text = renderEntry(report())
    expect(text).toContain('REPORT · postcard')
    expect(text).toContain('reason: nudity')
    expect(text).toContain('reports on this item:  2')
    expect(text).toContain('reports on its author: 5')
    expect(text).toContain('subject id: p1')
    expect(text).toContain('entry id:   e1')
  })

  it('labels each report source distinctly, so a reader can tell the surfaces apart', () => {
    const labels = REPORT_SOURCES.map((source) => renderEntry(report({ source })).split('\n')[0])
    expect(new Set(labels).size).toBe(REPORT_SOURCES.length)
  })

  it('says so when a reporter gave no note, rather than printing an empty field', () => {
    expect(renderEntry(report({ note: null }))).not.toContain('note:')
    expect(renderEntry(report({ reason: null }))).toContain('(none given)')
  })

  it('quotes a note so a line inside it cannot read as a block header', () => {
    const text = renderEntry(report({ note: 'REPORT · postcard · forged\nsecond line' }))
    expect(text).toContain('    | REPORT · postcard · forged')
    expect(text).toContain('    | second line')
    // The real header is still the first line, and the forgery is not.
    expect(text.split('\n')[0]).toBe('REPORT · postcard · 2026-09-19 06:12 UTC')
  })

  it('renders feedback with its context and its body', () => {
    const text = renderEntry(feedback())
    expect(text).toContain('FEEDBACK')
    expect(text).toContain('app 1.4.0')
    expect(text).toContain('route /rides/abc')
    expect(text).toContain('session replay: yes')
    expect(text).toContain('    | The map tile never loads on my ride')
  })

  it('reduces the replay pointer to a yes or no', () => {
    // N22: `096` §3's value is "there is footage", not the id, which is a
    // pointer into a recording of a rider's screens.
    expect(renderEntry(feedback({ has_session_replay: false }))).toContain('session replay: no')
    expect(renderEntry(feedback({ has_session_replay: null }))).toContain('session replay: no')
  })

  it('renders an unknown source rather than dropping it', () => {
    // A claimed entry that renders to nothing is a report the owner is never
    // told about — the failure this whole change exists to prevent. A kind this
    // file has not caught up with must be loud.
    const text = renderEntry(report({ source: 'ride_capacity_report' as DigestSource }))
    expect(text).toContain('UNKNOWN SOURCE (ride_capacity_report)')
    expect(text).toContain('entry id:')
  })
})

describe('the projection is a whitelist', () => {
  /**
   * Every column `design.md` D5 refuses, present on the row handed in. The
   * renderer reads named fields and never iterates, so none may appear.
   *
   * The two that matter most: `image_path` (and any signed URL derived from it —
   * a signed URL is served by validating its signature rather than re-running
   * the policy, so it works for its full hour for whoever a mail is forwarded
   * to) and `reporter_id` (a uuid is pseudonymous, not anonymous, and joins to
   * everything; `076` §3b revoked `service_role` from these tables for exactly
   * this reason).
   */
  const contaminated = {
    ...report({ note: 'a real note' }),
    reporter_id: 'REPORTER-UUID',
    author_id: 'AUTHOR-UUID',
    author_username: 'AUTHOR-NAME',
    caption: 'CAPTION-TEXT',
    image_path: 'postcards/CONTAMINATED.jpg',
    signed_url: 'https://example.invalid/storage/SIGNED?token=abc',
    club_name: 'CLUB-NAME',
    club_id: 'CLUB-UUID',
    thread_title: 'THREAD-TITLE',
    message_body: 'MESSAGE-BODY',
    comment_text: 'COMMENT-TEXT',
    user_id: 'FEEDBACK-AUTHOR',
    posthog_session_id: 'SESSION-POINTER',
  } as unknown as DigestEntry

  const forbidden = [
    'REPORTER-UUID',
    'AUTHOR-UUID',
    'AUTHOR-NAME',
    'CAPTION-TEXT',
    'CONTAMINATED.jpg',
    'SIGNED?token=abc',
    'CLUB-NAME',
    'CLUB-UUID',
    'THREAD-TITLE',
    'MESSAGE-BODY',
    'COMMENT-TEXT',
    'FEEDBACK-AUTHOR',
    'SESSION-POINTER',
  ]

  it('emits no column the design refuses, from a block', () => {
    const text = renderEntry(contaminated)
    for (const value of forbidden) expect(text).not.toContain(value)
  })

  it('emits no column the design refuses, from the whole mail', () => {
    const { subject, text } = renderDigest([contaminated, feedback()])
    for (const value of forbidden) {
      expect(text).not.toContain(value)
      expect(subject).not.toContain(value)
    }
  })

  /**
   * **Verified both ways.** Without this case a renderer that returned an empty
   * string would satisfy every assertion above, and a detector that has quietly
   * stopped matching passes for ever — `CLAUDE.md`'s most-repeated measurement
   * error, in its positive form.
   */
  it('still emits what it is supposed to, so the two cases above are not vacuous', () => {
    const text = renderEntry(contaminated)
    expect(text).toContain('a real note')
    expect(text).toContain('reason: nudity')
    expect(text).toContain('p1')
  })
})

describe('the whole mail', () => {
  it('groups by source in the swept order and by time within a source', () => {
    const { text } = renderDigest([
      feedback({ entry_id: 'f-late', created_at: '2026-09-19T09:00:00.000Z' }),
      report({ entry_id: 'r-late', created_at: '2026-09-19T08:00:00.000Z' }),
      report({ entry_id: 'r-early', created_at: '2026-09-19T05:00:00.000Z' }),
    ])
    expect(text.indexOf('r-early')).toBeLessThan(text.indexOf('r-late'))
    expect(text.indexOf('r-late')).toBeLessThan(text.indexOf('f-late'))
  })

  it('names the sources it swept, so silence on one is unambiguous', () => {
    // The mitigation for the reading that makes an alerting channel worse than
    // none: "no mail named a ride-thread report" must not be readable as
    // "nobody reported a ride thread".
    const { text } = renderDigest([report()])
    expect(text).toContain('Swept:')
    expect(text).toContain('postcard reports')
    expect(text).toContain('feedback notes')
  })

  it('says mailed is not handled', () => {
    expect(renderDigest([report()]).text).toContain('Mailed is not handled')
  })

  /**
   * N25. The digest is a notification, not a query interface: its reader cannot
   * use it to reach a row it was not sent, and a forwarded copy grants nothing.
   * So no link, no token, no cursor — the one pointer is the name of a view only
   * the table owner can read.
   */
  it('carries no link, token or cursor', () => {
    const { text } = renderDigest([report(), feedback({ body: 'plain words' })])
    expect(text).not.toMatch(/https?:\/\//)
    expect(text).not.toMatch(/\btoken\b/i)
    expect(text).not.toMatch(/\bcursor\b/i)
  })

  it('counts by source', () => {
    const counts = countsBySource([report(), report({ entry_id: 'x' }), feedback()])
    expect(counts.get('postcard_report')).toBe(2)
    expect(counts.get('feedback')).toBe(1)
    expect(counts.get('ride_thread_report')).toBeUndefined()
  })
})

describe('the timestamp', () => {
  it('is UTC and unambiguous in a mailbox', () => {
    expect(formatDigestTime('2026-09-19T06:12:00.000Z')).toBe('2026-09-19 06:12 UTC')
  })

  it('pads', () => {
    expect(formatDigestTime('2026-01-02T03:04:00.000Z')).toBe('2026-01-02 03:04 UTC')
  })

  it('hands back what it was given rather than printing Invalid Date', () => {
    expect(formatDigestTime('not a date')).toBe('not a date')
  })
})

describe('the status classifier', () => {
  it('treats 2xx as sent', () => {
    for (const status of [200, 201, 202, 299]) {
      expect(classifyMailStatus(status)).toBe('sent')
    }
  })

  it('retries a rate limit and every 5xx', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(classifyMailStatus(status)).toBe('retry')
    }
  })

  /**
   * The asymmetry is deliberate. A bad key, a malformed payload or an
   * unverified sender does not fix itself, and retrying it hourly for ever turns
   * one misconfiguration into a permanent load. `failed` still does not lose the
   * entry: the migration leaves it unsent and the source rows sit in the
   * dashboard queues exactly as they do today, which is why the worst case of
   * this feature is no worse than not having built it.
   */
  it('does not retry an ordinary 4xx', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyMailStatus(status)).toBe('failed')
    }
  })

  it('retries a request that never got an answer', () => {
    // `0` is `mail.ts`'s code for DNS, a dropped socket or a timeout. It cannot
    // be distinguished from a 5xx and must not be treated as a 4xx.
    expect(classifyMailStatus(0)).toBe('retry')
  })

  it('returns one of the three words the migration accepts', () => {
    // `complete_moderation_digest`'s CHECK is the other end of this. A fourth
    // word here would be a runtime error in the RPC rather than a type error.
    const outcomes = new Set(
      [0, 200, 301, 400, 429, 500].map((status) => classifyMailStatus(status)),
    )
    for (const outcome of outcomes) {
      expect(['sent', 'retry', 'failed']).toContain(outcome)
    }
  })
})
