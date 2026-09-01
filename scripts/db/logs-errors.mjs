#!/usr/bin/env node
/**
 * Reads the last 24h of failed Supabase requests for a project.
 *
 * WHY THIS EXISTS. The app is a client-rendered bundle talking to Supabase
 * directly, so every read and write a rider makes is an HTTP request that
 * Supabase logs — and a broken screen usually shows up here as a 4xx or 5xx
 * before anyone reports it. On 2026-08-27 the club Discussions→Threads rename
 * (PD-313) left 64 404s against `club_discussions` in this stream: `082`
 * applied to DEV at 15:26Z and merged at 16:16Z, so for those ~50 minutes the
 * schema was ahead of the Preview still calling the old relation. Nothing
 * alerted. They were found the same afternoon, by accident, while answering an
 * unrelated question — which is the part this script exists to fix. (DEV has no
 * riders, so the cost was a broken Preview rather than an outage. On PROD the
 * same window is rider-visible.)
 *
 * THE EXPIRY IS THE POINT. Free-tier log retention is about a day and the API
 * caps any single query at a 24-hour window, so a day nobody runs this is a day
 * that cannot be recovered later. `.github/workflows/log-digest.yml` (PD-352)
 * is what stops that being a habit nobody keeps; run it by hand too, at the
 * start of a session and after every promotion.
 *
 * WHAT IT CANNOT SEE — two things, and the first is the bigger half.
 *
 * An AUTH-LINK FAILURE IS A 302 and is invisible at status level. GoTrue answers
 * `/auth/v1/verify` and `/auth/v1/callback` with a redirect whether the token
 * was good or expired, and an unlisted `redirect_to` is DISCARDED rather than
 * refused — measured against the live PROD auth server on 2026-08-12, see
 * `docs/ENVIRONMENTS.md` §The redirect allowlist. So a rider whose confirmation
 * email dead-ends is byte-identical here to a rider signing in. This is a
 * structural limit rather than an oversight: the discriminator lives in the
 * query string, and `sanitisePath` strips that on purpose, because a query on
 * those paths carries a live credential. Widening the window would not fix it.
 *
 * And nothing here is a client-side JavaScript error. A component that throws renders `error.tsx`, logs to the
 * rider's own console, and leaves no trace on any server. Every row this prints
 * is a network call. Sentry (PD-315) is the other half; see
 * docs/reference/observability.md.
 *
 * NOT ALL 4xx ARE DEFECTS, and this is why `--ci` classifies rather than
 * counting. A 401 on `has_password_reset_grant` is the guard working; a 403 is
 * usually RLS refusing something correctly. Three shapes are ours: a 404 on
 * `/rest/v1/<table>` (schema ahead of the code, or behind it), a **300** on
 * one (`PGRST201` — the schema offers an embed more than one relationship, so
 * PostgREST resolves none), and a 5xx of any kind. Everything else is printed
 * and reported, never alerted on — an alert that fires on correct behaviour is
 * one nobody reads by the second week.
 *
 * THE 300 IS WHY THE WINDOW IS NOT `>= 400`, and it was added after this digest
 * sat through the outage it exists for. PD-363: `092` added an ordinary join
 * table, `club_members`↔`profiles` gained a second candidate relationship, and
 * both club lists, the club roster and the club timeline started returning
 * nothing — 65 rows on `/rest/v1/clubs` and 6 more on `/rest/v1/club_members`,
 * every one below the threshold this script was reading. Both numbers, with
 * their paths: a bare total loses the roster query, which is one of the four
 * screens the same sentence says went down. A status class that means "your
 * code and your schema disagree" is the whole remit here; that it sorts below
 * 400 is an accident of HTTP.
 *
 * CREDENTIAL. Needs a Supabase *Management API* personal access token in
 * SUPABASE_ACCESS_TOKEN — not the publishable key, not the service-role key,
 * and not anything that belongs in the app. Generate one at
 * https://supabase.com/dashboard/account/tokens. It is an operator credential:
 * keep it in the shell or in the repository secret of the same name, never in
 * .env.local, and never in the bundle.
 *
 * VERIFICATION STATUS — the two halves of this file differ, so read both.
 *
 * The SQL below IS verified, and the widened window is verified against real
 * failures rather than against an empty answer. Run on both projects through
 * the Supabase MCP `query_logs` tool on 2026-09-01, it executes on each and
 * DEV returns the rows the old `>= 400` could not see:
 *
 *     {"n":67,"path":"/rest/v1/clubs","status":300}
 *     {"n":8, "path":"/rest/v1/club_members","status":300}
 *     {"n":12,"path":"/rest/v1/club_members","status":401}   <- `other`, never alerted on
 *
 * PROD returns `{"result":[]}` in the same sitting, which is the correct answer
 * for a project still on `091` — it has no `club_join_waves` and therefore no
 * ambiguity — and is the state this window is meant to keep true through the
 * promotion.
 *
 * That is a stronger check than the one it replaces. The earlier note recorded
 * both projects returning NO rows, with a 200 from an unfiltered query as the
 * only evidence the shape worked at all; a filter that silently matches nothing
 * looks identical to a quiet day, which is exactly how the 300s went unseen.
 *
 * The HTTP transport here is still NOT verified, and NO SESSION CAN VERIFY IT,
 * which is the reason not to spend an afternoon on it. `api.supabase.com:443` is a
 * policy denial at the agent proxy: the gateway answers 403 to CONNECT, so
 * `fetch` reports the uninformative "fetch failed" and curl reports status 000.
 * Re-derive rather than trusting this line, because a network policy is exactly
 * the kind of thing that changes without telling anyone:
 *
 *     curl -sS "$HTTPS_PROXY/__agentproxy/status"   # recentRelayFailures
 *
 * A GitHub Actions runner has no such restriction, so
 * `.github/workflows/log-digest.yml` is not merely the schedule — it is the
 * only environment that can execute this file at all. Its first run is the
 * transport test, and `workflow_dispatch` exists so that run can be triggered
 * deliberately rather than waited for.
 *
 * What the envelope sighting DID settle is `result` as the key and `error` as
 * its sibling, which is why `parseRows` reads exactly those and throws on
 * anything else.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors           # DEV
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors -- --prod
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors -- --ci
 *
 * THREE EXIT CODES, because "the monitor is broken" and "something is broken"
 * are different news and a single non-zero cannot tell them apart. A missing
 * token, a dead transport and an unreadable envelope are all states where this
 * script knows NOTHING about the projects — reporting them the same way as a
 * PROD 5xx is how the alert stops being read:
 *
 *   0  ran, and nothing in the window is ours
 *   1  ran, and there is a 5xx, or a /rest/v1/ 404 or 300, to look at
 *   2  could not run — no token, no transport, or an envelope it cannot read
 *
 * Under `--ci` the reason is written to $GITHUB_STEP_SUMMARY in every one of the
 * three cases, including 2. Without that a broken run is a red job with an EMPTY
 * summary, which is the least legible way to say "I did not look".
 *
 * Behind the agent proxy, prefix with NODE_USE_ENV_PROXY=1.
 */

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PROJECTS = {
  dev: { ref: 'fpmrimzxadewsaiwpsel', label: 'letsride-dev (DEV)' },
  prod: { ref: 'zwprydcyryvudhurbnye', label: 'letsride (PRODUCTION)' },
}

// `log_attributes` values are strings, so the status has to be cast before it
// is compared: `>= '400'` is a lexicographic comparison that happens to be
// right for three-digit codes and is silently wrong for anything else.
// Exported ONLY so `logs-errors.test.ts` can pin the window. The classifier and
// the filter are two halves of one guarantee and the classifier was the only
// half with tests: reverting this predicate to `>= 400` leaves every assertion
// green while the digest goes blind to PD-363 again.
export const SQL = `
select toInt32OrZero(log_attributes['response.status_code']) as status,
       log_attributes['request.path'] as path,
       count(*) as n
from logs
where source = 'edge_logs'
  and (toInt32OrZero(log_attributes['response.status_code']) >= 400
       or toInt32OrZero(log_attributes['response.status_code']) = 300)
group by status, path
-- Alerting rows first, THEN frequency. The cap is a count, so ordered by n
-- alone a single 5xx (n=1) is the first row evicted, and "any 5xx is always
-- ours" is the loudest rule in this file. Widening the window added rows
-- competing for the same 50 slots, which moves that risk in the wrong
-- direction; this makes truncation unable to drop an alerting row while any
-- non-alerting one remains. The predicate restates the classifier's: keep
-- the two in step.
order by (status >= 500 or status = 404 or status = 300) desc, n desc
limit 50
`.trim()

// PostgREST serves every table read and write the app makes, and TWO statuses
// there mean the deployed bundle and the schema disagree.
//
// A 404 is not a missing row — PostgREST answers those 200 with an empty array
// — it is a missing *relation*.
//
// A 300 is PostgREST declining to CHOOSE. The measured case is `PGRST201`: an
// embed it will not resolve because the schema offers more than one
// relationship between the two tables. On an `/rest/v1/rpc/` path the same
// status also covers an overloaded function it cannot pick between
// (`PGRST203`) — UNOBSERVED here, and it cannot be observed today because no
// `public` function in this schema has an overload, which is why the wording
// below says "made something ambiguous" rather than naming an embed. The
// bucket is keyed on the path and the status rather than on the error code, so
// it holds either way; only the sentence would mislead.
//
// **300 is the reason this filter is not simply `>= 400`.** It sits below every
// threshold a monitor naturally reaches for, and it is not a rare curiosity: a
// migration adding an ordinary join table makes an untouched embed ambiguous,
// so a screen whose query, columns and policies did not change starts returning
// nothing. That is PD-363 — `092` took both club lists, the club roster and the
// club timeline down together; 65 of these landed on `/rest/v1/clubs` and 6
// more on `/rest/v1/club_members`, and this digest could not see one of them.
//
// The other 3xx are deliberately excluded rather than swept in by a `>= 300`:
// a 304 is a cache working (DEV's window holds them on avatar fetches) and a
// 301/302/307/308 is a redirect behaving. Widening to the band would put
// routine traffic in an alert that is only credible while every row in it is a
// question.
const REST_SEGMENT = '/rest/v1/'

// A `PGRST201` refusal. Named rather than inlined because `300` on its own,
// three lines below a `>= 500`, reads like a typo for one of the thresholds.
const AMBIGUOUS_EMBED = 300

const isServerError = (row) => Number(row.status) >= 500

// `includes` rather than `startsWith`, and the difference is a silent miss of
// the exact case this exists to catch. Anchored to the start, an absolute path
// would classify PD-313's 404s as unremarkable and the digest would stay green
// through the outage it was built for. No path that is not PostgREST contains
// this substring, so the looser test costs no false positives.
//
// The shape is now PARTLY observed and the observation does not settle it. DEV's
// filtered window on 2026-09-01 returned failure rows with RELATIVE paths
// (`/rest/v1/clubs`, `/rest/v1/club_members`), which is one status class on one
// project on one day — the direction that makes `startsWith` look adequate, and
// nowhere near enough to bet the digest on. Keep `includes`.
const isSchemaMismatch = (row) =>
  (Number(row.status) === 404 || Number(row.status) === AMBIGUOUS_EMBED) &&
  String(row.path ?? '').includes(REST_SEGMENT)

/**
 * Pull the rows out of the Management API envelope, or throw.
 *
 * THROWING IS THE WHOLE POINT, and the previous `payload.result ?? payload.data
 * ?? []` is the reason this function exists. An unrecognised envelope fell
 * through that to an empty array, which this script prints as "Nothing failed"
 * — so a renamed key, an error object, or an auth failure that still answers
 * 200 would report a clean day, for ever, in the one tool whose entire job is
 * noticing that something broke. A monitor that fails closed is useless; a
 * monitor that fails OPEN and says everything is fine is worse than none,
 * because it is trusted.
 *
 * `{ result: [] }` is different and must stay different: that is the API saying
 * the window genuinely holds no failures, which on a quiet day is the correct
 * and common answer.
 */
export function parseRows(payload) {
  if (payload && payload.error != null) {
    throw new Error(`The logs API returned an error: ${JSON.stringify(payload.error)}`)
  }
  const rows = payload?.result ?? payload?.data
  if (!Array.isArray(rows)) {
    throw new Error(
      'Unrecognised response envelope — expected `result` (or `data`) to be an array. ' +
        `Got keys: ${payload && typeof payload === 'object' ? Object.keys(payload).join(', ') || '(none)' : typeof payload}. ` +
        'Fix the key here rather than letting it read as a clean day.',
    )
  }
  return rows
}

/**
 * Split the rows into the two shapes that are ours and everything else.
 *
 * The split is what keeps the alert credible: `other` holds the 401s and 403s
 * that are guards working correctly, and they are always reported and never
 * alerted on.
 */
export function classify(rows) {
  return {
    serverErrors: rows.filter(isServerError),
    schemaMismatch: rows.filter(isSchemaMismatch),
    other: rows.filter((row) => !isServerError(row) && !isSchemaMismatch(row)),
  }
}

export function isAlerting({ serverErrors, schemaMismatch }) {
  return serverErrors.length > 0 || schemaMismatch.length > 0
}

/**
 * The schema-mismatch bucket, split by status for the reader.
 *
 * One bucket is right — a 404 and a 300 under `/rest/v1/` both mean the
 * deployed bundle and the schema disagree, and both are exit 1 — but the two
 * send the reader somewhere completely different, so a single count is a
 * disservice. A 404 is a missing relation and the remedy is the migration and
 * deploy order. A 300 is the schema making something AMBIGUOUS, and the remedy
 * is in the query: an FK hint on the embed. Reporting "N returned 404" over a
 * page of 300s, which is what this said before, sends an operator to diff
 * migration state against a deploy timestamp for a defect that lives in a
 * `.select()` string.
 *
 * Exported and used by BOTH the job summary and the interactive console. They
 * had drifted — the summary was updated for the widened bucket and the console
 * was not — and one function is what stops that happening again.
 */
export function describeSchemaMismatch(schemaMismatch) {
  const missing = schemaMismatch.filter((row) => Number(row.status) === 404).length
  const ambiguous = schemaMismatch.filter(
    (row) => Number(row.status) === AMBIGUOUS_EMBED,
  ).length

  const parts = []
  if (missing > 0) parts.push(`${missing} returned 404 (missing relation)`)
  if (ambiguous > 0) {
    parts.push(`${ambiguous} returned 300 (the schema made something ambiguous)`)
  }
  return parts.join(' and ')
}

/**
 * Make a logged path safe to publish in a job summary.
 *
 * A GitHub job summary is readable by anyone with repo read access and is kept
 * for 90 days — far longer than the ~24h window it describes — so anything that
 * lands in one has effectively been published. Two things follow:
 *
 * A QUERY STRING IS NEVER PRINTED. `/auth/v1/verify?token=...` and a signed
 * Storage URL both carry a live rider credential in the query, and a 4xx on
 * either is exactly the row this digest would report. GitHub's secret masking
 * cannot help: these are not registered secrets. Whether `request.path` ever
 * includes the query is unobserved, which is the reason to strip it now rather
 * than to find out from a summary that already published one.
 *
 * The pipe and backtick escaping is only cosmetic — an unescaped pipe breaks
 * the markdown table it sits in.
 */
export function sanitisePath(path) {
  return String(path ?? '')
    .split('?')[0]
    .split('#')[0]
    .replaceAll('|', '\\|')
    .replaceAll('`', "'")
}

/** One markdown table for the GitHub job summary. */
export function formatSummary(label, rows, classified) {
  const lines = [`## ${label}`, '']
  if (rows.length === 0) {
    lines.push('No 300, 4xx or 5xx in the last 24 hours.', '')
    return lines.join('\n')
  }
  if (isAlerting(classified)) {
    lines.push(
      `**${classified.serverErrors.length} path(s) returned 5xx** and, under ` +
        `\`${REST_SEGMENT}\`, **${describeSchemaMismatch(classified.schemaMismatch)}**.`,
      '',
    )
  } else {
    lines.push('Failures present, none of them alerting (see the script header).', '')
  }
  lines.push('| n | status | path |', '| --: | --- | --- |')
  for (const row of rows) {
    lines.push(`| ${row.n} | ${row.status} | \`${sanitisePath(row.path)}\` |`)
  }
  lines.push('')
  return lines.join('\n')
}

// Set once `--ci` is known, so `fail` can write the summary a red run owes.
let ciMode = false

/**
 * The monitor could not run. Exit 2, never 1.
 *
 * Exit 1 means "I looked and found something". Everything routed here means "I
 * did not look" — no token, no transport, an envelope I cannot read. Collapsing
 * the two is what turns a missing repository secret into four red jobs a day
 * that look exactly like a production 5xx, and an alert that cries wolf on
 * day one is the failure this whole design argues against.
 */
function fail(message) {
  console.error(`\n  ${message}\n`)
  writeSummary(`## Digest did not run\n\n${message}\n\nThis is exit 2 — the monitor could not read the window, which is NOT the same as a clean day and NOT the same as an alert.\n`)
  process.exit(2)
}

function writeSummary(markdown) {
  if (ciMode && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  }
}

async function main() {
  // Before the token check, so a missing token still writes its reason out.
  ciMode = process.argv.includes('--ci')

  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    fail(
      'SUPABASE_ACCESS_TOKEN is not set.\n\n' +
        '  This needs a Supabase Management API personal access token — the operator\n' +
        '  credential, not the publishable key and not the service-role key.\n' +
        '  Create one at https://supabase.com/dashboard/account/tokens and pass it in:\n\n' +
        '      SUPABASE_ACCESS_TOKEN=sbp_... npm run logs:errors\n\n' +
        '  Without a token the same query can still be run through the Supabase MCP\n' +
        '  `query_logs` tool — see docs/reference/observability.md.',
    )
  }

  const project = process.argv.includes('--prod') ? PROJECTS.prod : PROJECTS.dev

  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)

  const url = new URL(
    `https://api.supabase.com/v1/projects/${project.ref}/analytics/endpoints/logs.all`,
  )
  url.searchParams.set('sql', SQL)
  url.searchParams.set('iso_timestamp_start', start.toISOString())
  url.searchParams.set('iso_timestamp_end', end.toISOString())

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((error) => fail(`Could not reach the Management API: ${error.message}`))

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    fail(`Management API returned ${response.status}. ${body.slice(0, 400)}`)
  }

  let rows
  try {
    rows = parseRows(await response.json())
  } catch (error) {
    fail(error.message)
  }

  console.log(`\n  Failed requests, last 24h — ${project.label}`)
  console.log(`  ${start.toISOString()} → ${end.toISOString()}\n`)

  const classified = classify(rows)

  if (rows.length === 0) {
    console.log('  Nothing failed. That is a real answer, not an empty result:')
    console.log('  this window genuinely holds no 300, 4xx or 5xx.\n')
  } else {
    const width = Math.max(...rows.map((r) => String(r.path ?? '').length), 4)
    console.log(`  ${'n'.padStart(6)}  ${'status'.padEnd(6)}  path`)
    console.log(`  ${'-'.repeat(6)}  ${'-'.repeat(6)}  ${'-'.repeat(Math.min(width, 60))}`)
    for (const row of rows) {
      console.log(
        `  ${String(row.n).padStart(6)}  ${String(row.status).padEnd(6)}  ${row.path}`,
      )
    }

    console.log('')
    if (classified.serverErrors.length > 0) {
      console.log(
        `  ${classified.serverErrors.length} path(s) returned 5xx — these are ours, always.`,
      )
    }
    if (classified.schemaMismatch.length > 0) {
      console.log(
        `  Under ${REST_SEGMENT}: ${describeSchemaMismatch(classified.schemaMismatch)} — the\n` +
          '  deployed code and the schema disagree. A 404 is the migration/deploy\n' +
          '  order; a 300 is a query that needs an explicit relationship.',
      )
    }
    console.log('')
  }

  writeSummary(formatSummary(project.label, rows, classified))

  // `exitCode` rather than `exit()`: on a runner stdout is a pipe, and
  // `process.exit()` does not flush pending async writes to one — so the table
  // printed above can be truncated, partially, silently, and only in CI. Letting
  // the module end flushes it.
  //
  // Silence when there is nothing is the requirement, so a non-alerting run is 0
  // and the scheduled job stays green with its detail in the summary.
  process.exitCode = ciMode && isAlerting(classified) ? 1 : 0
}

// Only when invoked directly, so the pure helpers above can be imported and
// pinned by a test without this file reading the environment, making a network
// call, or calling process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
